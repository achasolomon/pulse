import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSecret } from "../../api/dist/modules/iam/domain/credentials.js";
import { withStaffFixture } from "./live-auth-smoke.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await fetch('http://localhost:3018/login',{signal:AbortSignal.timeout(60000)});
await fetch('http://localhost:3018/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://localhost:3018'},body:'{}',signal:AbortSignal.timeout(60000)});
await withStaffFixture(async ({ db, ids, loginId, secret }) => {
  const writes = [
    "patient:read",
    "entry:read",
    "imaging:view",
    "imaging:order",
    "imaging:cancel",
    "entry:write",
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
  const imagingProcedure=(await db.query("INSERT INTO img.procedure(code,name,instructions,version,modality,body_region,laterality_policy)VALUES($1,'Synthetic imaging procedure','Synthetic radiology instruction',1,'XR','knee','required')RETURNING id",['SYN-CHROME-'+randomUUID()])).rows[0].id;
  await db.query('INSERT INTO img.facility_procedure(facility_id,procedure_id)VALUES($1,$2)',[ids.facility,imagingProcedure]);
  const profile = await mkdtemp(join(tmpdir(), "pulse-notes-browser-"));
  const browser = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=9255",
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
        pages = await (await fetch("http://127.0.0.1:9255/json")).json();
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
        const requestId=++id;const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Chrome request timed out: '+method));},method==='Runtime.evaluate'?60000:20000);
        pending.set(requestId,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id:requestId,method,params}));
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
      const shot = await call("Page.captureScreenshot", { format: "png",captureBeyondViewport:false });
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
    await click('Tests & results');
    await click('Request imaging');
    await until('document.querySelector("[name=imagingProcedure]")');
    await evaluate('document.querySelector("[name=imagingProcedure]").click()');
    await fill('imagingIndication','Synthetic indication retained through review');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review order").disabled'),true);
    await evaluate('(()=>{const el=document.querySelector("[name=imagingLaterality]");el.value="left";el.dispatchEvent(new Event("change",{bubbles:true}));})()');await fill('imagingSafetyContext','Synthetic relevant safety context');
    await evaluate('(()=>{const el=document.querySelector("[name=imagingUrgency]");el.value="urgent";el.dispatchEvent(new Event("change",{bubbles:true}));})()');
    await screenshot('imaging-composer-desktop');await click('Review order');
    assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Place order").disabled'),true);
    await evaluate('document.querySelector("[name=imagingOrderAttestation]").click()');await screenshot('imaging-review-desktop');
    await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*/api/auth/imaging/*/orders']});await click('Place order');
    await until('document.querySelector("#imaging-order-drawer [role=alert]")');assert.ok(await evaluate('document.querySelector(".lab-order-review").textContent.includes("Synthetic indication retained through review")'));
    await call('Network.setBlockedURLs',{urls:[]});await click('Place order');await until('!document.querySelector("#imaging-order-drawer")');
    await until('document.querySelector(".record-history-list")?.textContent.includes("Synthetic imaging procedure")');
    let rows=(await db.query('SELECT id,status,procedure_id,procedure_version,ordered_by,urgency,laterality,safety_context FROM img.img_order WHERE patient_id=$1',[patient])).rows;assert.equal(rows.length,1);assert.equal(rows[0].ordered_by,ids.person);assert.equal(rows[0].procedure_id,imagingProcedure);assert.equal(rows[0].procedure_version,1);assert.equal(rows[0].urgency,'urgent');assert.equal(rows[0].laterality,'left');assert.equal(rows[0].safety_context,'Synthetic relevant safety context');
    await screenshot('imaging-ordered-history-desktop');await click('Review imaging request');await until('document.querySelector("[name=imagingCancelReason]")');
    await fill('imagingCancelReason','Synthetic request cancellation before collection');await click('Review cancellation');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);assert.equal(await evaluate('document.documentElement.scrollWidth'),390);await screenshot('imaging-cancellation-mobile');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('document.querySelector(".note-discard-warning")');await click('Keep editing');
    await click('Confirm cancellation');await until('!document.querySelector("#imaging-order-drawer")');await until('document.querySelector(".record-history-list")?.textContent.includes("Cancelled")');
    rows=(await db.query('SELECT status,version,cancelled_by,cancel_reason FROM img.img_order WHERE patient_id=$1',[patient])).rows;assert.equal(rows[0].status,'cancelled');assert.equal(rows[0].version,2);assert.equal(rows[0].cancelled_by,ids.person);
    await click('Request imaging');await until('document.querySelector("[name=imagingProcedure]")');await evaluate('document.querySelector("[name=imagingProcedure]").click()');await fill('imagingIndication','Synthetic indication after catalogue change');await evaluate('(()=>{const el=document.querySelector("[name=imagingLaterality]");el.value="right";el.dispatchEvent(new Event("change",{bubbles:true}));})()');await click('Review order');await evaluate('document.querySelector("[name=imagingOrderAttestation]").click()');
    await db.query('UPDATE img.facility_procedure SET active=false WHERE facility_id=$1 AND procedure_id=$2',[ids.facility,imagingProcedure]);await click('Place order');await until('document.querySelector("#imaging-order-drawer [role=alert]")?.textContent.includes("no longer available")');
    assert.ok(await evaluate('document.querySelector(".lab-order-review").textContent.includes("Synthetic indication after catalogue change")'));
    await click('Back');assert.equal(await evaluate('document.querySelector("[name=imagingIndication]").value'),'Synthetic indication after catalogue change');await click('Cancel');await click('Discard changes');
    await login(nurseLogin);await click('Tests & results');await until('document.querySelector(".record-history-list")');assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Request imaging")'),false);
    await click('Review imaging request');await until('document.querySelector("#imaging-order-drawer")');assert.equal(await evaluate('Boolean(document.querySelector("[name=imagingCancelReason]"))'),false);await click('Cancel');
    assert.equal(await evaluate('localStorage.length'),0);console.log('Imaging Chrome passed: required side selection and safety-context preservation; catalogue selection, review/attestation, outage retention, attributed ordering, history refresh, mobile cancellation/Escape protection, stale catalogue retention and nursing read-only controls.');
  } finally {
    socket?.close();
    browser.kill();
    await db.query(
      "DELETE FROM clin.note_addendum WHERE note_id IN(SELECT id FROM clin.note WHERE patient_id=$1)",
      [patient],
    );
    await db.query("DELETE FROM integration.outbox WHERE aggregate_type='imaging_order' AND aggregate_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)",[patient]);
    await db.query('DELETE FROM img.img_order WHERE patient_id=$1',[patient]);
    await db.query('DELETE FROM img.facility_procedure WHERE procedure_id=$1',[imagingProcedure]);await db.query('DELETE FROM img.procedure WHERE id=$1',[imagingProcedure]);
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
