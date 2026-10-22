import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSecret } from "../../api/dist/modules/iam/domain/credentials.js";
import { withStaffFixture } from "./live-auth-smoke.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let apiReady=false;for(let n=0;n<60;n++){try{const r=await fetch('http://localhost:3048/api/v1/health/live');if(r.status<500){apiReady=true;break;}}catch{}await delay(250);}assert.ok(apiReady,'Isolated API must be ready before starting the browser fixture');
await withStaffFixture(async ({ db, ids, loginId, secret }) => {
  const writes = ['patient:read','lab:read','lab:worklist','lab:collect','lab:accession','lab:result'];  await db.query("UPDATE iam.membership SET privileges=$1 WHERE id=$2", [
    writes,
    ids.membership,
  ]);
  const nurse = randomUUID(),
    nurseLogin = `notes-nurse-${randomUUID()}`;
  await db.query(
    "INSERT INTO iam.credential(person_id,login_id,secret_hash)VALUES($1,$2,$3)",
    [nurse, nurseLogin, hashSecret(secret)],
  );
  await db.query(
    "INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,ARRAY['lab_verifier'],$4)",
    [nurse, ids.organization, ids.facility, ['patient:read','lab:read','lab:worklist','lab:verify']],
  );
  const clinician=randomUUID(),clinicianLogin='critical-clinician-'+randomUUID();
  await db.query('INSERT INTO iam.credential(person_id,login_id,secret_hash)VALUES($1,$2,$3)',[clinician,clinicianLogin,hashSecret(secret)]);
  await db.query("INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,ARRAY['clinician'],ARRAY['patient:read','lab:read','lab:critical:ack'])",[clinician,ids.organization,ids.facility]);
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
  for (const actor of [ids.person, nurse,clinician])
    await db.query(
      "INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,encounter_id,kind)VALUES($1,$2,$3,$4,'note-browser-test')",
      [actor, patient, ids.facility, encounter],
    );
  await db.query("INSERT INTO clin.observation(patient_id,encounter_id,code,value_num,unit,origin)VALUES($1,$2,'heart-rate',72,'bpm','local')",[patient,encounter]);
  const labTest=(await db.query("INSERT INTO lab.test(code,name,specimen_requirement,version)VALUES($1,'Synthetic laboratory test','Synthetic specimen requirement',1)RETURNING id",['SYN-CHROME-'+randomUUID()])).rows[0].id;
  await db.query('INSERT INTO lab.facility_test(facility_id,test_id)VALUES($1,$2)',[ids.facility,labTest]);
  await db.query("UPDATE iam.membership SET roles=ARRAY['lab_technician'] WHERE id=$1",[ids.membership]);
  await db.query('DELETE FROM iam.care_assignment WHERE person_id=$1 AND patient_id=$2',[ids.person,patient]);
  await db.query("INSERT INTO lab.lab_order(patient_id,encounter_id,test_id,test_version,indication,created_at)VALUES($1,$2,$3,1,'Synthetic laboratory duty indication',now()-interval '1 minute')",[patient,encounter,labTest]);
  const profile = await mkdtemp(join(tmpdir(), "pulse-notes-browser-"));
  const browser = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=9253",
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
        pages = await (await fetch("http://127.0.0.1:9253/json")).json();
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
        const requestId=++id;
        const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Chrome request timed out: '+method));},20000);
        pending.set(requestId, {resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
        socket.send(JSON.stringify({ id:requestId, method, params }));
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
    const login = async (username,target='worklists') => {
      await call("Page.navigate", { url: "http://localhost:3018/login" });
      await until('document.querySelector("#login-id:not([disabled])")');
      assert.equal(
        await evaluate(
          `(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ loginId: username, secret })})});if(!r.ok)return r.status;return(await fetch('/api/auth/facility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({facilityId:${JSON.stringify(ids.facility)}})})).status;})()`,
        ),
        200,
      );
      await call("Page.navigate", {
        url: `http://localhost:3018/${target}`,
      });
      await until(target==='worklists'?'document.querySelector(".lab-queue")':'document.querySelector(".critical-worklist-row")');

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
    await until('document.querySelector(".lab-queue__row")');
    assert.equal(await evaluate('(async()=>{const r=await fetch("/api/auth/patients/'+patient+'/chart");return r.status;})()'),403);
    await click('Review request');await until('document.querySelector("[name=specimenContainer]")');
    await fill('specimenContainer','Synthetic collection container');await fill('specimenLabel','SPEC-CHROME-001');
    await evaluate('document.querySelector("[name=specimenIdentityConfirmed]").click()');await screenshot('lab-collection-desktop');await click('Review collection');
    await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*/api/auth/laboratory/orders/*/collect']});await click('Confirm collection');await until('document.querySelector("#lab-specimen-drawer [role=alert]")');
    assert.ok(await evaluate('document.querySelector(".lab-order-review").textContent.includes("SPEC-CHROME-001")'));
    await call('Network.setBlockedURLs',{urls:[]});await click('Confirm collection');await until('!document.querySelector("#lab-specimen-drawer")');await until('document.querySelector(".lab-queue__row")?.textContent.includes("Awaiting receipt")');
    let rows=(await db.query('SELECT r.status,r.version,s.collected_by,s.identity_confirmed,s.label FROM lab.lab_order r JOIN lab.specimen s ON s.order_id=r.id WHERE r.patient_id=$1',[patient])).rows;assert.equal(rows.length,1);assert.equal(rows[0].status,'collected');assert.equal(rows[0].collected_by,ids.person);assert.equal(rows[0].identity_confirmed,true);
    await screenshot('lab-queue-collected-desktop');await click('Review request');await until('document.querySelector("[name=accessionNumber]")');await fill('accessionNumber','ACC-CHROME-001');await evaluate('document.querySelector("[name=specimenIdentityConfirmed]").click()');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);assert.equal(await evaluate('document.documentElement.scrollWidth'),390);await screenshot('lab-receipt-mobile');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('document.querySelector(".note-discard-warning")');await click('Keep editing');await click('Review receipt');
    await db.query('UPDATE lab.lab_order SET version=version+1 WHERE patient_id=$1',[patient]);await click('Confirm accession');await until('document.querySelector("#lab-specimen-drawer [role=alert]")?.textContent.includes("has changed")');assert.ok(await evaluate('document.querySelector(".lab-order-review").textContent.includes("ACC-CHROME-001")'));
    await click('Cancel');await click('Discard changes');await click('Review request');await until('document.querySelector("[name=accessionNumber]")');await fill('accessionNumber','ACC-CHROME-001');await evaluate('document.querySelector("[name=specimenIdentityConfirmed]").click()');await click('Review receipt');await screenshot('lab-accession-review-mobile');await click('Confirm accession');
    await until('!document.querySelector("#lab-specimen-drawer")');await until('document.querySelector(".lab-queue__row")?.textContent.includes("Ready for testing")');assert.equal(await evaluate('document.documentElement.scrollWidth'),390);
    rows=(await db.query('SELECT r.status,a.received_by,a.accession_number FROM lab.lab_order r JOIN lab.specimen s ON s.order_id=r.id JOIN lab.specimen_accession a ON a.specimen_id=s.id WHERE r.patient_id=$1',[patient])).rows;assert.equal(rows[0].status,'accessioned');assert.equal(rows[0].received_by,ids.person);assert.equal(rows[0].accession_number,'ACC-CHROME-001');

    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await click('Review request');await until('document.querySelector("[name=resultComponent]")');
    await fill('resultComponent','Synthetic bench component');await fill('resultValue','Synthetic reviewed value');await fill('resultUnit','unit');await evaluate('(()=>{const el=document.querySelector("[name=resultFlag]");el.value="critical";el.dispatchEvent(new Event("change",{bubbles:true}));})()');await evaluate('document.querySelector("[name=resultAttestation]").click()');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('document.querySelector(".note-discard-warning")');await click('Keep editing');
    await evaluate('document.querySelector(".lab-results").scrollIntoView({block:"start"})');await screenshot('lab-result-entry-desktop');await click('Review component');
    await call('Network.setBlockedURLs',{urls:['*/api/auth/laboratory/orders/*/results']});await click('Save for verification');await until('document.querySelector(".lab-results [role=alert]")');assert.ok(await evaluate('document.querySelector(".lab-results").textContent.includes("Synthetic reviewed value")'));
    await call('Network.setBlockedURLs',{urls:[]});await click('Save for verification');await until('document.querySelector(".lab-results__list")?.textContent.includes("Synthetic reviewed value")');
    assert.equal((await db.query('SELECT status FROM lab.lab_order WHERE patient_id=$1',[patient])).rows[0].status,'resulted');

    await click('Cancel');await login(nurseLogin);await until('document.querySelector(".lab-queue__row")');await click('Review request');await until('document.querySelector('+JSON.stringify('[name=criticalRecipient] option[value="'+clinician+'"]')+')');
    await evaluate('(()=>{const el=document.querySelector("[name=criticalRecipient]");el.value='+JSON.stringify(clinician)+';el.dispatchEvent(new Event("change",{bubbles:true}));})()');
    const dueDate=new Date(Date.now()+3600000),dueLocal=new Date(dueDate.getTime()-dueDate.getTimezoneOffset()*60000).toISOString().slice(0,16);
    await fill('criticalDueAt',dueLocal);await evaluate('document.querySelector("[name=criticalConfirmation]").click()');
    await call('Network.setBlockedURLs',{urls:['*/api/auth/critical-results/orders/*/notify']});await click('Confirm & assign follow-up');await until('document.querySelector(".critical-followup [role=alert]")');assert.equal(await evaluate('document.querySelector("[name=criticalRecipient]").value'),clinician);
    await call('Network.setBlockedURLs',{urls:[]});await click('Confirm & assign follow-up');await until('document.querySelector("[name=criticalContactTime]")');
    await evaluate('document.querySelector(".critical-followup").scrollIntoView({block:"start"})');await screenshot('critical-assigned-desktop');
    await click('Save contact attempt');await until('document.querySelectorAll(".critical-followup .lab-results__list li").length===1 && [...document.querySelectorAll(".critical-followup button")].some(b=>b.textContent==="Save contact attempt"&&!b.disabled)');
    await evaluate('(()=>{const el=document.querySelector("[name=criticalOutcome]");el.value="reached";el.dispatchEvent(new Event("change",{bubbles:true}));})()');await until('document.querySelector("[name=criticalReadBack]")');await evaluate('document.querySelector("[name=criticalReadBack]").click()');await click('Save contact attempt');await until('document.querySelector(".critical-followup").textContent.includes("Read-back confirmed")');
    assert.equal(await evaluate('document.querySelector("[name=verificationAttestation]")'),null);
    await click('Cancel');await login(clinicianLogin,'critical-results');await until('document.querySelector(".critical-indicator")?.textContent.includes("1")');await click('Review critical finding');await until('document.querySelector("[name=criticalAcknowledgement]")');assert.ok(await evaluate('document.querySelector("#critical-result-drawer").textContent.includes("Synthetic reviewed value")'));
    assert.equal((await db.query('SELECT acknowledged_at FROM lab.critical_case WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=$1)',[patient])).rows[0].acknowledged_at,null);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth'),390);
    await evaluate('document.querySelector("[name=criticalAcknowledgement]").click()');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('document.querySelector(".note-discard-warning")');await click('Keep editing');
    await evaluate('document.querySelector("[name=criticalAcknowledgement]").scrollIntoView({block:"center"})');await screenshot('critical-clinician-ack-mobile');
    await call('Network.setBlockedURLs',{urls:['*/api/auth/critical-results/orders/*/acknowledge']});await click('Acknowledge critical finding');await until('document.querySelector(".critical-followup [role=alert]")');assert.equal(await evaluate('document.querySelector("[name=criticalAcknowledgement]").checked'),true);
    await call('Network.setBlockedURLs',{urls:[]});await click('Acknowledge critical finding');await until('document.querySelector(".critical-followup").textContent.includes("Acknowledgement recorded")');await until('document.querySelector(".critical-indicator strong")?.textContent==="0"');await screenshot('critical-acknowledged-mobile');
    await click('Cancel');await login(nurseLogin);await click('Review request');await until('document.querySelector("[name=verificationAttestation]")');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);assert.equal(await evaluate('document.documentElement.scrollWidth'),390);
    assert.equal(await evaluate('document.querySelector("[name=resultComponent]")'),null);
    await evaluate('document.querySelector("[name=verificationAttestation]").click()');await evaluate('document.querySelector(".lab-results__verification").scrollIntoView({block:"center"})');await screenshot('lab-result-verification-mobile');await click('Verify & publish report');
    await until('document.querySelector(".lab-results").textContent.includes("Report verified and published")');
    const report=(await db.query('SELECT status,verified_by,verified_at FROM lab.lab_order WHERE patient_id=$1',[patient])).rows[0];assert.equal(report.status,'verified');assert.equal(report.verified_by,nurse);assert.ok(report.verified_at);assert.equal((await db.query('SELECT critical_ack_by FROM lab.lab_order WHERE patient_id=$1',[patient])).rows[0].critical_ack_by,clinician);await evaluate('document.querySelector(".lab-results").scrollIntoView({block:"start"})');await screenshot('lab-result-final-mobile');
    assert.equal(await evaluate('localStorage.length'),0);console.log('Critical communication Chrome passed: named assignment, network retention, failed/successful contact with read-back, clinician mobile acknowledgement, header count, separate final publication; collection/accession, attributed component review, outage retention/retry, separate verifier, mobile verification/publication and immutable final controls.');

  } finally {
    socket?.close();
    browser.kill();
    await db.query(
      "DELETE FROM clin.note_addendum WHERE note_id IN(SELECT id FROM clin.note WHERE patient_id=$1)",
      [patient],
    );
    await db.query("DELETE FROM integration.outbox WHERE aggregate_type='lab_order' AND aggregate_id IN(SELECT id FROM lab.lab_order WHERE patient_id=$1)",[patient]);
    await db.query('DELETE FROM lab.specimen_accession WHERE specimen_id IN(SELECT s.id FROM lab.specimen s JOIN lab.lab_order r ON r.id=s.order_id WHERE r.patient_id=$1)',[patient]);
    await db.query('DELETE FROM lab.specimen_identity WHERE specimen_id IN(SELECT s.id FROM lab.specimen s JOIN lab.lab_order r ON r.id=s.order_id WHERE r.patient_id=$1)',[patient]);
    await db.query('DELETE FROM lab.critical_contact WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=$1)',[patient]);
    await db.query('DELETE FROM lab.critical_case WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=$1)',[patient]);
    await db.query('DELETE FROM lab.result WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=$1)',[patient]);
    await db.query('DELETE FROM lab.specimen WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=$1)',[patient]);
    await db.query('DELETE FROM lab.lab_order WHERE patient_id=$1',[patient]);
    await db.query('DELETE FROM lab.facility_test WHERE test_id=$1',[labTest]);await db.query('DELETE FROM lab.test WHERE id=$1',[labTest]);
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
    await db.query("DELETE FROM iam.session WHERE person_id=$1",[clinician]);await db.query("DELETE FROM iam.credential WHERE person_id=$1",[clinician]);await db.query("DELETE FROM iam.membership WHERE person_id=$1",[clinician]);
  }
});
