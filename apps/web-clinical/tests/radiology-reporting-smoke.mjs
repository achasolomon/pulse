import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withStaffFixture} from './live-auth-smoke.mjs';
import {randomUUID} from 'node:crypto';
import {syntheticDicomPixels} from '../../../scripts/lib/synthetic-dicom-pixels.mjs';
assert.equal(process.env.PULSE_PACS_SYNTHETIC_TEST,'yes');
const pacsCredentials=JSON.parse(await readFile('tmp/pacs/credentials.json','utf8'));
const pacs=async(path,options={})=>fetch('http://127.0.0.1:8043'+path,{...options,headers:{Authorization:'Basic '+Buffer.from(pacsCredentials.username+':'+pacsCredentials.password).toString('base64'),...options.headers},redirect:'error',signal:AbortSignal.timeout(10000)});
assert.equal((await(await pacs('/system')).json()).Name,'Pulse Local Development PACS');
let pacsStudy,pacsUid;
await fetch('http://localhost:3018/login',{signal:AbortSignal.timeout(60000)});
await fetch('http://localhost:3018/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3018'},body:'{}',signal:AbortSignal.timeout(60000)});
await withStaffFixture(async({db,ids,loginId,secret})=>{
const x={acquisitionTemplate:randomUUID(),patient:randomUUID(),encounter:randomUUID(),procedure:randomUUID(),template:randomUUID(),order:randomUUID(),resource:randomUUID(),slot:randomUUID(),review:randomUUID()};
try{
await db.query("UPDATE iam.membership SET privileges=ARRAY['patient:read','imaging:view','imaging:worklist','imaging:protocol','imaging:schedule','imaging:arrival','imaging:no-show','imaging:acquire','imaging:report','imaging:finalize'] WHERE id=$1",[ids.membership]);
await db.query("INSERT INTO patient.patient(id,given_name,family_name,date_of_birth,sex,facility_id)VALUES($1,'Synthetic Ada','Scheduling','1990-01-15','F',$2)",[x.patient,ids.facility]);
await db.query("INSERT INTO encounter.encounter(id,patient_id,facility_id,type)VALUES($1,$2,$3,'outpatient')",[x.encounter,x.patient,ids.facility]);
await db.query("INSERT INTO img.procedure(id,code,name,modality,body_region,laterality_policy)VALUES($1,$2,'Synthetic schedule XR','XR','chest','na')",[x.procedure,randomUUID()]);
await db.query("INSERT INTO img.protocol_template(id,code,name,procedure_id,version,instructions,policy_reference,checks)VALUES($1,$2,'Synthetic planning protocol',$3,1,'Synthetic instructions','Synthetic policy',$4::jsonb)",[x.template,randomUUID(),x.procedure,JSON.stringify([{key:'identity',label:'Synthetic identity confirmation',allowNotApplicable:false}])]);
await db.query('INSERT INTO img.facility_protocol(facility_id,template_id)VALUES($1,$2)',[ids.facility,x.template]);
await db.query("INSERT INTO img.img_order(id,patient_id,encounter_id,procedure_id,procedure_version,procedure_code,body_region,laterality)VALUES($1,$2,$3,$4,1,'SYN-SCHEDULE','chest','na')",[x.order,x.patient,x.encounter,x.procedure]);
await db.query("INSERT INTO img.protocol_review(id,order_id,template_id,template_version,order_version,decision,responses,reason,reviewed_by)VALUES($1,$2,$3,1,1,'approved',$4::jsonb,'Synthetic planning approval',$5)",[x.review,x.order,x.template,JSON.stringify({identity:{outcome:'clear',note:'Synthetic identity confirmation'}}),ids.person]);
await db.query('UPDATE img.img_order SET version=2 WHERE id=$1',[x.order]);
await db.query("INSERT INTO img.schedule_resource(id,facility_id,code,name,modality,location)VALUES($1,$2,$3,'Synthetic X-ray room','XR','Synthetic imaging department')",[x.resource,ids.facility,randomUUID()]);
const start=new Date();start.setDate(start.getDate()+1);start.setHours(10,0,0,0);const end=new Date(start.getTime()+30*60000);
await db.query('INSERT INTO img.schedule_slot(id,resource_id,procedure_id,starts_at,ends_at)VALUES($1,$2,$3,$4,$5)',[x.slot,x.resource,x.procedure,start,end]);
const bookingDay=start.getFullYear()+'-'+String(start.getMonth()+1).padStart(2,'0')+'-'+String(start.getDate()).padStart(2,'0');
await db.query("INSERT INTO patient.identifier(patient_id,facility_id,system,value)VALUES($1,$2::uuid,'urn:pulse:mrn:'||$2::text,$3)",[x.patient,ids.facility,'SYN-ACQ-'+randomUUID()]);
await db.query("INSERT INTO img.acquisition_template(id,code,name,procedure_id,version,dicom_modality,instructions,policy_reference,checks)VALUES($1,$2,'Synthetic procedure-day checklist',$3,1,'DX','Synthetic checks only','TEST ONLY',$4::jsonb)",[x.acquisitionTemplate,randomUUID(),x.procedure,JSON.stringify([{key:'day',label:'Synthetic day verification',allowNotApplicable:false}])]);
await db.query('INSERT INTO img.facility_acquisition_template(facility_id,template_id)VALUES($1,$2)',[ids.facility,x.acquisitionTemplate]);
const profile=await mkdtemp(join(tmpdir(),'pulse-workspace-'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const browser = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=9284",
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
        pages = await (await fetch("http://127.0.0.1:9284/json")).json();
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

 await call('Page.enable');await call('Network.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});


 await call('Page.navigate',{url:'http://localhost:3018/login'});await until('document.querySelector("#login-id")');
 const status=await evaluate('(async()=>{const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify('+JSON.stringify({loginId,secret})+')});if(!r.ok)return r.status;return(await fetch("/api/auth/facility",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({facilityId:'+JSON.stringify(ids.facility)+'})})).status;})()');assert.equal(status,200);
 await call('Page.navigate',{url:'http://localhost:3018/worklists?queue=radiology'});await until('document.querySelector(".radiology-open")');await evaluate('document.querySelector(".radiology-open").click()');await until('document.querySelector(".radiology-detail h2")');
 const click=async text=>{await until('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==='+JSON.stringify(text)+'&&!b.disabled)');await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+').click()');await delay(100);};
 const set=async(name,value)=>{const selector=JSON.stringify('[name="'+name+'"]');await evaluate('(()=>{const el=document.querySelector('+selector+');Object.getOwnPropertyDescriptor(el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));})()');};
 await click('Schedule imaging');await until('document.querySelector("[name=imagingBookingDate]")');await set('imagingBookingDate',bookingDay);await until('document.querySelector("[name=imagingSlot]")');
 assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review booking").disabled'),true);
 await evaluate('document.querySelector("[name=imagingSlot]").click()');await set('imagingScheduleReason','Synthetic Chrome scheduling handover');await click('Review booking');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Confirm booking").disabled'),true);
 await evaluate('document.querySelector("[name=scheduleAttestation]").click()');const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/scheduling-review-desktop.png',Buffer.from(shot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('document.body.textContent.includes("Discard this unsaved review?")');await click('Keep editing');const mobile=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/scheduling-review-mobile.png',Buffer.from(mobile.data,'base64'));
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/schedule']});await click('Confirm booking');await until('document.querySelector(".protocol-form [role=alert]")');assert.equal(await evaluate('document.querySelector(".protocol-form").textContent.includes("Synthetic Chrome scheduling handover")'),true);
 await call('Network.setBlockedURLs',{urls:[]});await click('Confirm booking');await until('document.querySelector(".radiology-booking strong")');assert.equal(await evaluate('document.querySelector(".radiology-booking").textContent.includes("Synthetic X-ray room")'),true);
 const persisted=(await db.query('SELECT o.status,o.version,b.booked_by,b.reason FROM img.img_order o JOIN img.schedule_booking b ON b.order_id=o.id WHERE o.id=$1',[x.order])).rows;assert.equal(persisted.length,1);assert.equal(persisted[0].status,'scheduled');assert.equal(persisted[0].version,3);assert.equal(persisted[0].booked_by,ids.person);
 assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Schedule imaging")'),false);

 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await click('Record arrival');await until('document.querySelector("[name=arrival-full-name]")');
 await evaluate('document.querySelector("[name=arrival-full-name]").click()');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review arrival").disabled'),true);await evaluate('document.querySelector("[name=arrival-date-of-birth]").click()');await set('arrivalNote','Synthetic verified attendance handover');await click('Review arrival');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Confirm arrival").disabled'),true);await evaluate('document.querySelector("[name=arrivalAttestation]").click()');
 const desktop=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/arrival-review-desktop.png',Buffer.from(desktop.data,'base64'));
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/arrive']});await click('Confirm arrival');await until('document.querySelector(".protocol-form [role=alert]")');assert.equal(await evaluate('document.querySelector(".protocol-form").textContent.includes("Synthetic verified attendance handover")'),true);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('document.body.textContent.includes("Discard this unsaved review?")');await click('Keep editing');const arrivalMobile=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/arrival-review-mobile.png',Buffer.from(arrivalMobile.data,'base64'));
 await call('Network.setBlockedURLs',{urls:[]});await click('Confirm arrival');await until('document.querySelector(".radiology-arrival-summary")');assert.equal((await db.query('SELECT arrived_by FROM img.booking_arrival WHERE booking_id IN(SELECT id FROM img.schedule_booking WHERE order_id=$1)',[x.order])).rows[0].arrived_by,ids.person);

 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await click('Prepare acquisition');await until('document.querySelector("[name=acquisitionTemplate]")');await set('acquisitionTemplate',x.acquisitionTemplate);await until('document.querySelector("[name=acquisition-day]")');
 await set('acquisition-day','concern');await set('acquisitionReason','Synthetic Chrome acquisition handover');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review acquisition").disabled'),true);
 await set('acquisition-day','clear');await set('acquisition-note-day','Synthetic day evidence');await click('Review acquisition');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Confirm preparation").disabled'),true);await evaluate('document.querySelector("[name=acquisitionAttestation]").click()');
 const prepShot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/acquisition-preparation-desktop.png',Buffer.from(prepShot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('document.body.textContent.includes("Discard this unsaved review?")');await click('Keep editing');
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/acquisition-prepare']});await click('Confirm preparation');await until('document.querySelector(".radiology-acquisition [role=alert]")');assert.equal(await evaluate('document.querySelector("[name=acquisitionReason]").value'), 'Synthetic Chrome acquisition handover');await call('Network.setBlockedURLs',{urls:[]});await click('Confirm preparation');await until('document.querySelector(".radiology-acquisition")?.textContent.includes("awaiting verified study")');
 const work=(await db.query('SELECT * FROM img.acquisition_case WHERE order_id=$1',[x.order])).rows[0];assert.ok(work);assert.equal((await db.query('SELECT status FROM img.img_order WHERE id=$1',[x.order])).rows[0].status,'protocolled');
 await click('Verify received study');await set('acquisitionReason','Synthetic completed study handover');await click('Review acquisition');await evaluate('document.querySelector("[name=acquisitionAttestation]").click()');await click('Verify & record acquisition');await until('document.querySelector(".radiology-acquisition [role=alert]")?.textContent.includes("has not arrived")');assert.equal((await db.query('SELECT count(*)::int AS count FROM img.study WHERE order_id=$1',[x.order])).rows[0].count,0);
 pacsUid=work.study_uid;const seriesUid='2.25.'+BigInt('0x'+randomUUID().replaceAll('-','')).toString();
 for(let n=0;n<3;n++){const response=await pacs('/tools/create-dicom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({Force:true,Tags:{PatientID:work.patient_id_value,IssuerOfPatientID:work.issuer,PatientName:'SYNTHETIC^ACQUISITION',PatientBirthDate:work.birth_date,AccessionNumber:work.accession,StudyInstanceUID:work.study_uid,SeriesInstanceUID:seriesUid,Modality:work.dicom_modality,StudyDescription:'SYNTHETIC QA PHANTOM - NOT CLINICAL',InstanceNumber:String(n+1),SOPClassUID:'1.2.840.10008.5.1.4.1.1.7'},Content:syntheticDicomPixels(n)})});assert.equal(response.status,200);const instance=await response.json();if(pacsStudy)assert.equal(instance.ParentStudy,pacsStudy);pacsStudy=instance.ParentStudy;}
 const mobileShot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/acquisition-confirmation-mobile.png',Buffer.from(mobileShot.data,'base64'));
 await click('Verify & record acquisition');await until('document.querySelector(".radiology-acquisition")?.textContent.includes("Study verified & acquired")');const completed=(await db.query('SELECT done.* FROM img.acquisition_completion done JOIN img.acquisition_case c ON c.id=done.case_id WHERE c.order_id=$1',[x.order])).rows[0];assert.equal(completed.instance_count,3);assert.equal(completed.verified_by,ids.person);assert.equal((await db.query('SELECT status FROM img.img_order WHERE id=$1',[x.order])).rows[0].status,'acquired');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);

 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await click('Draft report');await until('document.querySelector("[name=report-findings]")');
 await set('report-technique','Synthetic image acquisition only');await set('report-comparison','Synthetic comparison');await set('report-findings','Synthetic reporting findings - version one');await set('report-impression','Synthetic impression');await set('report-recommendations','Synthetic follow-up recommendation');await set('reportReason','Synthetic initial report');await click('Review draft');
 const draftShot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/radiology-report-draft-desktop.png',Buffer.from(draftShot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('document.body.textContent.includes("Discard this unsaved review?")');await click('Keep editing');
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/report-drafts']});await click('Save report draft');await until('document.querySelector(".radiology-reporting [role=alert]")');assert.equal(await evaluate('document.querySelector(".radiology-reporting").textContent.includes("Synthetic reporting findings - version one")'),true);
 await call('Network.setBlockedURLs',{urls:[]});await click('Save report draft');await until('document.querySelector(".radiology-reporting")?.textContent.includes("Draft - not released")||document.querySelector(".radiology-reporting")?.textContent.includes("Draft")');await until('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Revise draft")');
 await click('Revise draft');await set('report-findings','Synthetic reporting findings - version two');await set('reportReason','Synthetic revised findings');await click('Review draft');await click('Save report draft');await until('document.querySelector(".radiology-reporting")?.textContent.includes("Version 2")');assert.equal((await db.query('SELECT count(*)::int AS n FROM img.report WHERE order_id=$1',[x.order])).rows[0].n,2);
 await click('Review & finalise');await until('document.querySelector("[name=reportReviewReference]")');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review sign-off").disabled'),true);await set('reportReviewReference','Synthetic diagnostic workstation review reference');await set('reportReason','Synthetic final interpretation review');await click('Review sign-off');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Sign final report").disabled'),true);await evaluate('document.querySelector("[name=reportAttestation]").click()');
 const signShot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/radiology-report-signoff-mobile.png',Buffer.from(signShot.data,'base64'));assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/report-signoff']});await click('Sign final report');await until('document.querySelector(".radiology-reporting [role=alert]")');assert.equal((await db.query('SELECT status FROM img.img_order WHERE id=$1',[x.order])).rows[0].status,'reported');await call('Network.setBlockedURLs',{urls:[]});await click('Sign final report');await until('document.querySelector(".radiology-reporting")?.textContent.includes("Finalised by")');
 const final=(await db.query('SELECT r.status,r.version,sign.verified_by FROM img.report r JOIN img.report_signoff sign ON sign.report_id=r.id WHERE r.order_id=$1',[x.order])).rows[0];assert.equal(final.status,'final');assert.equal(final.version,2);assert.equal(final.verified_by,ids.person);assert.equal((await db.query('SELECT status FROM img.img_order WHERE id=$1',[x.order])).rows[0].status,'final');
 assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Revise draft")'),false);
 console.log('Reporting Chrome passed: real synthetic Orthanc acquisition, structured report, draft/revision retention, mobile Escape/overflow, blocked-save retries, explicit image-review reference and sign-off attestation, immutable final report and final order.');

 }finally{socket?.close();browser.kill();}
 }finally{
 if(pacsStudy){assert.match(pacsStudy,/^[a-f0-9]{8}(?:-[a-f0-9]{8}){4}$/);const stored=await(await pacs('/studies/'+pacsStudy)).json();assert.equal(stored.MainDicomTags.StudyInstanceUID,pacsUid);assert.equal((await pacs('/studies/'+pacsStudy,{method:'DELETE'})).status,200);}
 await db.query('DELETE FROM img.report_signoff WHERE report_id IN(SELECT id FROM img.report WHERE order_id=$1)',[x.order]);await db.query('DELETE FROM img.staff_report_detail WHERE report_id IN(SELECT id FROM img.report WHERE order_id=$1)',[x.order]);await db.query('DELETE FROM img.report WHERE order_id=$1',[x.order]);
 await db.query('DELETE FROM img.acquisition_completion WHERE case_id IN(SELECT id FROM img.acquisition_case WHERE order_id=$1)',[x.order]);await db.query('DELETE FROM img.acquisition_case WHERE order_id=$1',[x.order]);await db.query('DELETE FROM img.study WHERE order_id=$1',[x.order]);await db.query('DELETE FROM img.facility_acquisition_template WHERE template_id=$1',[x.acquisitionTemplate]);await db.query('DELETE FROM img.acquisition_template WHERE id=$1',[x.acquisitionTemplate]);await db.query('DELETE FROM patient.identifier WHERE patient_id=$1',[x.patient]);
 await db.query('DELETE FROM integration.staff_command WHERE organization_id=$1',[ids.organization]);
 await db.query("DELETE FROM integration.outbox WHERE aggregate_type='imaging_order' AND aggregate_id=$1",[x.order]);
 if(x.noShowOrder){await db.query("DELETE FROM integration.outbox WHERE aggregate_type='imaging_order' AND aggregate_id=$1",[x.noShowOrder]);await db.query('DELETE FROM img.booking_release WHERE booking_id IN(SELECT id FROM img.schedule_booking WHERE order_id=$1)',[x.noShowOrder]);await db.query('DELETE FROM img.schedule_reservation WHERE order_id=$1',[x.noShowOrder]);await db.query('DELETE FROM img.schedule_booking WHERE order_id=$1',[x.noShowOrder]);await db.query('DELETE FROM img.protocol_review WHERE order_id=$1',[x.noShowOrder]);await db.query('DELETE FROM img.img_order WHERE id=$1',[x.noShowOrder]);}
 await db.query('DELETE FROM img.booking_arrival WHERE booking_id IN(SELECT id FROM img.schedule_booking WHERE order_id=$1)',[x.order]);
 await db.query('DELETE FROM img.schedule_reservation WHERE order_id=$1',[x.order]);await db.query('DELETE FROM img.booking_release WHERE booking_id IN(SELECT id FROM img.schedule_booking WHERE order_id=$1)',[x.order]);
 await db.query('DELETE FROM img.schedule_booking WHERE order_id=$1',[x.order]);await db.query('DELETE FROM img.schedule_slot WHERE resource_id=$1',[x.resource]);await db.query('DELETE FROM img.schedule_resource WHERE id=$1',[x.resource]);
 await db.query('DELETE FROM img.protocol_review WHERE order_id=$1',[x.order]);await db.query('DELETE FROM img.img_order WHERE id=$1',[x.order]);await db.query('DELETE FROM img.facility_protocol WHERE template_id=$1',[x.template]);await db.query('DELETE FROM img.protocol_template WHERE id=$1',[x.template]);await db.query('DELETE FROM img.procedure WHERE id=$1',[x.procedure]);await db.query('DELETE FROM encounter.encounter WHERE id=$1',[x.encounter]);await db.query('DELETE FROM patient.patient WHERE id=$1',[x.patient]);
 }
});
