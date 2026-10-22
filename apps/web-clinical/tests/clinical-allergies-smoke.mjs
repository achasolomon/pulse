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
    "entry:read",
    "allergy:write",
    "entry:write",
    "encounter:read",
    "note:read",
    "note:write",
    "note:sign",
    "note:amend",
    "observation:read",
  ];
  await db.query("UPDATE iam.membership SET privileges=$1 WHERE id=$2", [
    [...writes, "encounter:consult", "allergy:correct"],
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
    await click('Problems & allergies');
    await until('document.querySelector(".allergy-record")');
    await click('Review allergy status');
    await until('document.querySelector("[name=allergyReviewStatus]")');
    await evaluate('document.querySelector("[name=allergyReviewStatus][value=no-known-allergies]").click()');
    await fill('allergyReason','Synthetic explicit negative review');
    await evaluate('document.querySelector("[name=allergyAttestation]").click()');
    await click('Record review');
    await until('!document.querySelector("#allergy-drawer")');
    await until('document.querySelector(".patient-banner__safety").textContent.includes("No known allergies")');
    await click('Add allergy');
    await until('document.querySelector("[name=allergySubstance]")');
    await fill('allergySubstance','Synthetic Penicillin');
    await fill('allergyReaction','Synthetic recorded reaction');
    async function choose(name,value){await evaluate('(()=>{const el=document.querySelector('+JSON.stringify('[name='+name+']')+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event("change",{bubbles:true}));})()');}
    await choose('allergyCategory','medication');await choose('allergySeverity','severe');await choose('allergyCriticality','high');await choose('allergyVerification','confirmed');
    await screenshot('allergy-drawer-desktop');
    await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*/api/auth/allergies/*/add']});
    await click('Save allergy');await until('document.querySelector("#allergy-drawer [role=alert]")');
    assert.equal(await evaluate('document.querySelector("[name=allergyReaction]").value'),'Synthetic recorded reaction');
    await call('Network.setBlockedURLs',{urls:[]});await click('Save allergy');
    await until('!document.querySelector("#allergy-drawer")');
    await until('document.querySelector(".patient-banner__safety").textContent.includes("High criticality")');
    assert.ok(await evaluate('document.querySelector(".allergy-record").textContent.includes("Clinician confirmed")'));
    await screenshot('allergy-high-criticality-overview');
    await click('Review allergy status');
    await until('document.querySelector("[name=allergyReviewStatus]")');
    await evaluate('document.querySelector("[name=allergyReviewStatus][value=no-known-allergies]").click()');
    await fill('allergyReason','Synthetic contradictory review');await evaluate('document.querySelector("[name=allergyAttestation]").click()');
    await click('Record review');await until('document.querySelector("#allergy-drawer [role=alert]")?.textContent.includes("conflicts")');
    assert.equal(await evaluate('document.querySelector("[name=allergyReason]").value'),'Synthetic contradictory review');
    await click('Cancel');await click('Discard changes');
    await click('Correct erroneous entry');await until('document.querySelector("[name=allergyReason]")');
    await fill('allergyReason','Synthetic entered-in-error explanation');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);
    assert.equal(await evaluate('document.documentElement.scrollWidth'),390);await screenshot('allergy-correction-mobile');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('document.querySelector(".note-discard-warning")');await click('Keep editing');
    await click('Mark entered in error');await until('!document.querySelector("#allergy-drawer")');
    await until('document.querySelector(".patient-banner__safety").textContent.includes("Allergy status unknown")');
    let rows=(await db.query('SELECT n.display,n.status,d.reaction,d.correction_reason FROM clin.entry n JOIN clin.allergy_detail d ON d.entry_id=n.id WHERE n.patient_id=$1',[patient])).rows;
    assert.equal(rows[0].display,'Synthetic Penicillin');assert.equal(rows[0].reaction,'Synthetic recorded reaction');assert.equal(rows[0].status,'resolved');assert.equal(rows[0].correction_reason,'Synthetic entered-in-error explanation');
    await login(nurseLogin);await click('Problems & allergies');await until('document.querySelector(".allergy-record")');
    await click('Add allergy');await until('document.querySelector("[name=allergyVerification]")');
    assert.equal(await evaluate('Boolean(document.querySelector("[name=allergyVerification] option[value=confirmed]"))'),false);
    await fill('allergySubstance','Synthetic food sensitivity');await fill('allergyReaction','Synthetic reported food reaction');await choose('allergyCategory','food');
    await screenshot('allergy-nursing-mobile');await click('Save allergy');await until('!document.querySelector("#allergy-drawer")');
    await until('document.querySelector(".allergy-record__list")');assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Correct erroneous entry")'),false);
    rows=(await db.query("SELECT recorded_by,verification_status FROM clin.entry WHERE patient_id=$1 AND status='active'",[patient])).rows;assert.equal(rows[0].recorded_by,nurse);assert.equal(rows[0].verification_status,'provisional');
    assert.equal(await evaluate('localStorage.length'),0);
    console.log('Allergy Chrome passed: explicit negative review, structured allergy, header criticality/refresh, outage/conflict retention, preserved correction, mobile Escape guard and nursing permissions.');
  } finally {
    socket?.close();
    browser.kill();
    await db.query(
      "DELETE FROM clin.note_addendum WHERE note_id IN(SELECT id FROM clin.note WHERE patient_id=$1)",
      [patient],
    );
    const cleanup=await db.connect();try{await cleanup.query('BEGIN');await cleanup.query("SET LOCAL session_replication_role='replica'");await cleanup.query('DELETE FROM clin.allergy_review WHERE patient_id=$1',[patient]);await cleanup.query('COMMIT');}catch(e){await cleanup.query('ROLLBACK');throw e;}finally{cleanup.release();}
    await db.query('DELETE FROM clin.allergy_detail WHERE entry_id IN(SELECT id FROM clin.entry WHERE patient_id=$1)',[patient]);
    await db.query("DELETE FROM clin.entry WHERE patient_id=$1", [patient]);
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
