import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSecret } from "../../api/dist/modules/iam/domain/credentials.js";
import { withStaffFixture } from "./live-auth-smoke.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await withStaffFixture(async ({ db, ids, loginId, secret }) => {
  const writes = [
    "patient:read",
    "encounter:read",
    "note:read",
    "note:write",
    "note:sign",
    "note:amend",
    "observation:read",
  ];
  await db.query("UPDATE iam.membership SET privileges=$1 WHERE id=$2", [
    [...writes, "encounter:consult"],
    ids.membership,
  ]);
  const nurse = randomUUID(),
    nurseLogin = `notes-nurse-${randomUUID()}`;
  await db.query(
    "INSERT INTO iam.credential(person_id,login_id,secret_hash)VALUES($1,$2,$3)",
    [nurse, nurseLogin, hashSecret(secret)],
  );
  await db.query(
    "INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,ARRAY['nurse'],$4)",
    [nurse, ids.organization, ids.facility, [...writes, "note:nursing"]],
  );
  const patient = (
    await db.query(
      "INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id)VALUES('Synthetic Ada','NoteReview','1990-01-15','F',$1)RETURNING id",
      [ids.facility],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO patient.identifier(patient_id,facility_id,system,value)VALUES($1,$2,$3,'NOTES-001')",
    [patient, ids.facility, "urn:pulse:mrn:" + ids.facility],
  );
  const encounter = (
    await db.query(
      "INSERT INTO encounter.encounter(patient_id,facility_id,type)VALUES($1,$2,'outpatient')RETURNING id",
      [patient, ids.facility],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO encounter.outpatient_visit(encounter_id,organization_id,facility_id,patient_id,stage,nurse_person_id,clinician_person_id,checked_in_by)VALUES($1,$2,$3,$4,'in-consultation',$5,$6,$6)",
    [encounter, ids.organization, ids.facility, patient, nurse, ids.person],
  );
  for (const actor of [ids.person, nurse])
    await db.query(
      "INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,encounter_id,kind)VALUES($1,$2,$3,$4,'note-browser-test')",
      [actor, patient, ids.facility, encounter],
    );
  await db.query("INSERT INTO clin.observation(patient_id,encounter_id,code,value_num,unit,origin)VALUES($1,$2,'heart-rate',72,'bpm','local')",[patient,encounter]);
  const profile = await mkdtemp(join(tmpdir(), "pulse-notes-browser-"));
  const browser = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=9249",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let socket;
  try {
    let pages;
    for (let n = 0; n < 50; n++) {
      try {
        pages = await (await fetch("http://127.0.0.1:9249/json")).json();
        break;
      } catch {
        await delay(200);
      }
    }
    socket = new WebSocket(
      pages.find((p) => p.type === "page").webSocketDebuggerUrl,
    );
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.id) {
        const p = pending.get(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        pending.delete(m.id);
      }
    };
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const until = async (expression) => {
      for (let n = 0; n < 150; n++) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await delay(200);
      }
      assert.fail(
        `Timed out: ${expression}; body=${await evaluate("document.body.innerText")}`,
      );
    };
    const click = async (text) => {
      await until(
        `[...document.querySelectorAll('button')].some(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(text)}&&!b.disabled)`,
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(text)}&&!b.disabled).click()`,
      );
      await delay(150);
    };
    const fill = async (name, value) => {
      const tab={history:'Subjective',examination:'Objective',assessment:'Assessment',plan:'Plan'}[name];
      if(tab){
        await click(tab);
        await until(`document.querySelector('[data-note-field="${name}"]')`);
        await evaluate(`(()=>{const el=document.querySelector('[data-note-field="${name}"]');el.focus();const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);})()`);
        await call('Input.insertText',{text:value});await delay(150);return;
      }
      await until(`document.querySelector('[name="${name}"]:not([disabled])')`);
      await evaluate(`(()=>{const el=document.querySelector('[name="${name}"]');const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event("input",{bubbles:true}));})()`);
    };
    const login = async (username) => {
      await call("Page.navigate", { url: "http://localhost:3018/login" });
      await until('document.querySelector("#login-id:not([disabled])")');
      assert.equal(
        await evaluate(
          `(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ loginId: username, secret })})});if(!r.ok)return r.status;return(await fetch('/api/auth/facility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({facilityId:${JSON.stringify(ids.facility)}})})).status;})()`,
        ),
        200,
      );
      await call("Page.navigate", {
        url: `http://localhost:3018/patients/${patient}`,
      });
      await until('document.querySelector(".record-contact-summary")');
      await click("Clinical notes");
    };
    await mkdir("tmp/clinical-notes-evidence", { recursive: true });
    const screenshot = async (name) => {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `tmp/clinical-notes-evidence/${name}.png`,
        Buffer.from(shot.data, "base64"),
      );
    };
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await login(loginId);
    await click("New note");
    await until('document.querySelector("[data-note-field=history]")');
    await evaluate(`(()=>{const el=document.querySelector('[data-note-field=history]');el.focus();const data=new DataTransfer();data.setData('text/html','<p><strong>Reviewed pasted history</strong><img src="invalid" onerror="window.notePasteExecuted=true"><script>window.notePasteExecuted=true</script></p>');data.setData('text/plain','Reviewed pasted history');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`);
    await until('document.querySelector("[data-note-field=history] strong")');
    assert.ok(await evaluate('document.querySelector("[data-note-field=history]").innerText.includes("Reviewed pasted history")'));
    assert.equal(await evaluate('Boolean(window.notePasteExecuted || document.querySelector("[data-note-field=history] img, [data-note-field=history] script"))'),false);
    await evaluate('(()=>{const el=document.querySelector("[data-note-field=history]");el.focus();const range=document.createRange();range.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(range);})()');
    await click('Clear formatting');
    await fill('history','Existing authored history');
    await click('General consultation');
    await until('document.querySelector(".note-template-preview")');
    await click('Append template');
    assert.ok(await evaluate('document.querySelector("[data-note-field=history]").innerText.trimEnd().startsWith("Existing authored history")'));
    assert.ok(await evaluate('document.querySelector("[data-note-field=history]").innerText.includes("History of present illness:")'));
    await click('Objective');
    await until('!document.querySelector("#note-panel-objective").hidden');
    await fill('examination','Synthetic observed findings');
    await evaluate('[...document.querySelectorAll(".note-insert-list button")].find(b=>b.textContent.includes("Vitals")).click()');
    await until('document.querySelector(".note-context-preview")');
    assert.ok(await evaluate('document.querySelector(".note-context-preview pre").textContent.includes("72 bpm")'));
    await click('Append reviewed context');
    assert.ok(await evaluate('document.querySelector("[data-note-field=examination]").innerText.trimEnd().startsWith("Synthetic observed findings")'));
    assert.ok(await evaluate('document.querySelector("[data-note-field=examination]").innerText.includes("source: local")'));
    await click('Subjective');
    await fill("chiefComplaint", "Synthetic follow-up consultation");
    await fill("history", "Synthetic clinical history for review");
    await fill("assessment", "Synthetic assessment");
    await fill("plan", "Synthetic follow-up plan");
    await click("Subjective");
    await evaluate('(()=>{const el=document.querySelector("[data-note-field=history]");el.focus();const range=document.createRange();range.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(range);})()');
    await click("Bold");
    await until('document.querySelector("[data-note-field=history] strong")');
    await click('Italic');
    await click('Underline');
    await until('document.querySelector("[data-note-field=history] em u, [data-note-field=history] u em")');
    await click('Numbered list');
    await until('document.querySelector("[data-note-field=history] ol")');
    await click('Undo');
    await until('!document.querySelector("[data-note-field=history] ol")');
    await click('Redo');
    await until('document.querySelector("[data-note-field=history] ol")');
    await click('Undo');
    await screenshot("consultation-draft-desktop");
    await click("Cancel");
    await until('document.querySelector(".note-discard-warning")');
    assert.ok(
      await evaluate('document.querySelector("#clinical-note-editor").open'),
    );
    await click("Keep editing");
    assert.equal(
      await evaluate('document.querySelector("[data-note-field=history]").innerText.trimEnd()'),
      "Synthetic clinical history for review",
    );
    await call("Network.enable");
    await call("Network.setBlockedURLs", {
      urls: ["*/api/auth/notes/patients/*"],
    });
    await click("Save draft");
    await until('document.querySelector("#clinical-note-editor [role=alert]")');
    assert.equal(
      await evaluate('document.querySelector("[data-note-field=plan]").innerText.trimEnd()'),
      "Synthetic follow-up plan",
    );
    await call("Network.setBlockedURLs", { urls: [] });
    await click("Save draft");
    await until('document.querySelector(".note-save-message")');
    await click("Cancel");
    await until('!document.querySelector("#clinical-note-editor")');
    await click("Edit draft");
    await until(
      'document.querySelector("[data-note-field=history]")?.innerText.trimEnd()==="Synthetic clinical history for review"',
    );
    assert.ok(await evaluate('Boolean(document.querySelector("[data-note-field=history] strong"))'));
    await fill("history", "Synthetic updated clinical history");
    await click("Save draft");
    await until(
      'document.querySelector(".workflow-identity")?.textContent.includes("Revision 2")',
    );
    const note = (
      await db.query(
        "SELECT id FROM clin.note WHERE patient_id=$1 AND author_id=$2",
        [patient, ids.person],
      )
    ).rows[0].id;
    assert.equal(
      await evaluate(
        `(async()=>{const read=await(await fetch('/api/auth/notes/${note}')).json();const r=await fetch('/api/auth/notes/${note}/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chiefComplaint:read.chiefComplaint,history:read.history,examination:read.examination,assessment:read.assessment,plan:'Saved in another tab',expectedVersion:read.version,commandKey:crypto.randomUUID()})});return r.status;})()`,
      ),
      200,
    );
    await fill("history", "Unsent local text must survive a conflict");
    await click("Save draft");
    await until(
      'document.querySelector("#clinical-note-editor [role=alert]")?.textContent.includes("Your text is still here")',
    );
    assert.equal(
      await evaluate('document.querySelector("[data-note-field=history]").innerText.trimEnd()'),
      "Unsent local text must survive a conflict",
    );
    await screenshot("draft-conflict");
    await click("Cancel");
    await click("Discard changes");
    await until('!document.querySelector("#clinical-note-editor")');
    await click("Edit draft");
    await until(
      'document.querySelector("[data-note-field=plan]")?.innerText.trimEnd()==="Saved in another tab"',
    );
    await click("Review & sign");
    await until('document.querySelector(".note-attestation input")');
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Sign note").disabled',
      ),
      true,
    );
    await screenshot("sign-review-desktop");
    await evaluate('document.querySelector(".note-attestation input").click()');
    await click("Sign note");
    await until('!document.querySelector("#clinical-note-editor")');
    await until(
      'document.querySelector(".record-note-actions button")?.textContent==="Add addendum"',
    );
    const original = (
      await db.query(
        "SELECT plan,history,signed_at FROM clin.note WHERE id=$1",
        [note],
      )
    ).rows[0];
    await click("Add addendum");
    await fill("addendum", "Synthetic attributed clarification after signing");
    await click("Append addendum");
    await until('!document.querySelector("#clinical-note-editor")');
    await until(
      'document.querySelector(".record-history-item details")?.textContent.includes("Synthetic attributed clarification")',
    );
    await evaluate(
      'document.querySelector(".record-history-item details").open=true',
    );
    await screenshot("signed-note-addendum");
    const after = (
      await db.query(
        "SELECT plan,history,signed_at FROM clin.note WHERE id=$1",
        [note],
      )
    ).rows[0];
    assert.deepEqual(after, original);
    assert.equal(
      (
        await db.query(
          "SELECT author_id FROM clin.note_addendum WHERE note_id=$1",
          [note],
        )
      ).rows[0].author_id,
      ids.person,
    );
    await login(nurseLogin);
    await click("New note");
    await fill("chiefComplaint", "Synthetic nursing progress note");
    await fill("history", "Synthetic nursing observations and care delivered");
    await fill("plan", "Synthetic nursing follow-up");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(200);
    assert.equal(await evaluate("document.documentElement.scrollWidth"), 390);
    await screenshot("nursing-draft-mobile");
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await until('document.querySelector(".note-discard-warning")');
    assert.equal(await evaluate('document.querySelector("#clinical-note-editor").open'),true);
    await click("Keep editing");
    await click("Review & sign");
    await until('document.querySelector(".note-attestation input")');
    assert.equal(await evaluate('document.querySelector("#clinical-note-editor").open'),true);
    await delay(200);
    await screenshot("nursing-review-mobile");
    await evaluate('document.querySelector(".note-attestation input").click()');
    await click("Sign note");
    await until('!document.querySelector("#clinical-note-editor")');
    const nursing = (
      await db.query(
        "SELECT note_type,status,author_id FROM clin.note WHERE patient_id=$1 AND author_id=$2",
        [patient, nurse],
      )
    ).rows;
    assert.deepEqual(nursing, [
      { note_type: "nursing", status: "signed", author_id: nurse },
    ]);
    assert.equal(await evaluate("localStorage.length"), 0);
    console.log(
      "Clinical notes Chrome passed: consultation and nursing drafts, resume, outage retention, unsaved-change/Escape guards, revision conflict retention, review/attestation/signing, immutable signed text, attributed addenda and mobile drawer.",
    );
  } finally {
    socket?.close();
    browser.kill();
    await db.query(
      "DELETE FROM clin.note_addendum WHERE note_id IN(SELECT id FROM clin.note WHERE patient_id=$1)",
      [patient],
    );
    await db.query("DELETE FROM clin.note WHERE patient_id=$1", [patient]);
    await db.query("DELETE FROM clin.observation WHERE patient_id=$1", [patient]);
    await db.query(
      "DELETE FROM integration.staff_command WHERE facility_id=$1",
      [ids.facility],
    );
    await db.query(
      "DELETE FROM encounter.outpatient_visit_history WHERE visit_id IN(SELECT id FROM encounter.outpatient_visit WHERE patient_id=$1)",
      [patient],
    );
    await db.query(
      "DELETE FROM encounter.outpatient_visit WHERE patient_id=$1",
      [patient],
    );
    await db.query("DELETE FROM iam.care_assignment WHERE patient_id=$1", [
      patient,
    ]);
    await db.query("DELETE FROM encounter.encounter WHERE patient_id=$1", [
      patient,
    ]);
    await db.query("DELETE FROM patient.identifier WHERE patient_id=$1", [
      patient,
    ]);
    await db.query("DELETE FROM patient.patient WHERE id=$1", [patient]);
    await db.query(
      "DELETE FROM iam.session WHERE credential_id IN(SELECT id FROM iam.credential WHERE person_id=$1)",
      [nurse],
    );
    await db.query("DELETE FROM iam.credential WHERE person_id=$1", [nurse]);
    await db.query("DELETE FROM iam.membership WHERE person_id=$1", [nurse]);
  }
});
