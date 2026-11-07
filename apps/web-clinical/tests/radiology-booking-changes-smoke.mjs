import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withStaffFixture} from './live-auth-smoke.mjs';
import {randomUUID} from 'node:crypto';
await fetch('http://localhost:3018/login',{signal:AbortSignal.timeout(60000)});
await fetch('http://localhost:3018/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3018'},body:'{}',signal:AbortSignal.timeout(60000)});
await withStaffFixture(async({db,ids,loginId,secret})=>{
const x={patient:randomUUID(),encounter:randomUUID(),procedure:randomUUID(),template:randomUUID(),order:randomUUID(),resource:randomUUID(),slot:randomUUID(),replacement:randomUUID(),review:randomUUID()};
try{
await db.query("UPDATE iam.membership SET privileges=ARRAY['patient:read','imaging:view','imaging:worklist','imaging:protocol','imaging:schedule','imaging:reschedule','imaging:appointment:cancel'] WHERE id=$1",[ids.membership]);
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
await db.query('INSERT INTO img.schedule_slot(id,resource_id,procedure_id,starts_at,ends_at)VALUES($1,$2,$3,$4,$5)',[x.replacement,x.resource,x.procedure,end,new Date(end.getTime()+30*60000)]);
const bookingDay=start.getFullYear()+'-'+String(start.getMonth()+1).padStart(2,'0')+'-'+String(start.getDate()).padStart(2,'0');
const profile=await mkdtemp(join(tmpdir(),'pulse-workspace-'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const browser = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=9274",
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
        pages = await (await fetch("http://127.0.0.1:9274/json")).json();
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
 const set=async(name,value)=>{const selector=JSON.stringify('[name="'+name+'"]');await evaluate('(()=>{const el=document.querySelector('+selector+');Object.getOwnPropertyDescriptor(el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));})()');};
 await click('Schedule imaging');await until('document.querySelector("[name=imagingBookingDate]")');await set('imagingBookingDate',bookingDay);await until('document.querySelector("[name=imagingSlot]")');
 assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review booking").disabled'),true);
 await evaluate('document.querySelector("[name=imagingSlot]").click()');await set('imagingScheduleReason','Synthetic Chrome scheduling handover');await click('Review booking');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Confirm booking").disabled'),true);
 await evaluate('document.querySelector("[name=scheduleAttestation]").click()');const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/scheduling-review-desktop.png',Buffer.from(shot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('document.body.textContent.includes("Discard this unsaved review?")');await click('Keep editing');const mobile=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/scheduling-review-mobile.png',Buffer.from(mobile.data,'base64'));
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/schedule']});await click('Confirm booking');await until('document.querySelector(".protocol-form [role=alert]")');assert.equal(await evaluate('document.querySelector(".protocol-form").textContent.includes("Synthetic Chrome scheduling handover")'),true);
 await call('Network.setBlockedURLs',{urls:[]});await click('Confirm booking');await until('document.querySelector(".radiology-booking strong")');assert.equal(await evaluate('document.querySelector(".radiology-booking").textContent.includes("Synthetic X-ray room")'),true);
 const persisted=(await db.query('SELECT o.status,o.version,b.booked_by,b.reason FROM img.img_order o JOIN img.schedule_booking b ON b.order_id=o.id WHERE o.id=$1',[x.order])).rows;assert.equal(persisted.length,1);assert.equal(persisted[0].status,'scheduled');assert.equal(persisted[0].version,3);assert.equal(persisted[0].booked_by,ids.person);
 assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Schedule imaging")'),false);
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await click('Reschedule appointment');await until('document.querySelector("[name=imagingBookingDate]")');await set('imagingBookingDate',bookingDay);await until('document.querySelector("[name=imagingSlot]")');assert.equal(await evaluate('document.querySelectorAll("[name=imagingSlot]").length'),1);
 await evaluate('document.querySelector("[name=imagingSlot]").click()');await set('imagingScheduleReason','Synthetic replacement reason');await click('Review booking');await evaluate('document.querySelector("[name=scheduleAttestation]").click()');
 const reshot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/rescheduling-review-desktop.png',Buffer.from(reshot.data,'base64'));
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/reschedule']});await click('Confirm rescheduling');await until('document.querySelector(".protocol-form [role=alert]")');assert.equal((await db.query('SELECT slot_id FROM img.schedule_reservation WHERE order_id=$1',[x.order])).rows[0].slot_id,x.slot);
 await call('Network.setBlockedURLs',{urls:[]});await click('Confirm rescheduling');await until('document.querySelector(".radiology-booking strong")');assert.equal((await db.query('SELECT slot_id FROM img.schedule_reservation WHERE order_id=$1',[x.order])).rows[0].slot_id,x.replacement);assert.equal(await evaluate('document.querySelector(".radiology-detail").textContent.includes("Synthetic replacement reason")'),true);
 await click('Cancel appointment');await until('document.querySelector("[name=appointmentCancelReason]")');await set('appointmentCancelReason','Synthetic appointment cancellation reason');await click('Review cancellation');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Confirm appointment cancellation").disabled'),true);await evaluate('document.querySelector("[name=appointmentCancelAttestation]").click()');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('document.body.textContent.includes("Discard this unsaved review?")');await click('Keep editing');
 const cancellation=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/appointment-cancel-mobile.png',Buffer.from(cancellation.data,'base64'));
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/appointment-cancel']});await click('Confirm appointment cancellation');await until('document.querySelector(".protocol-form [role=alert]")');assert.equal((await db.query('SELECT slot_id FROM img.schedule_reservation WHERE order_id=$1',[x.order])).rows[0].slot_id,x.replacement);
 await call('Network.setBlockedURLs',{urls:[]});await click('Confirm appointment cancellation');await until('document.querySelector(".radiology-booking")?.textContent.includes("No appointment booked")');
 const after=(await db.query('SELECT status,version FROM img.img_order WHERE id=$1',[x.order])).rows[0];assert.equal(after.status,'ordered');assert.equal(after.version,5);assert.equal((await db.query('SELECT count(*)::int AS count FROM img.schedule_reservation WHERE order_id=$1',[x.order])).rows[0].count,0);const releases=(await db.query('SELECT kind,released_by FROM img.booking_release WHERE booking_id IN(SELECT id FROM img.schedule_booking WHERE order_id=$1)',[x.order])).rows;assert.equal(releases.length,2);assert.ok(releases.every(r=>r.released_by===ids.person));
 assert.equal(await evaluate('document.querySelector(".radiology-detail").textContent.includes("Synthetic appointment cancellation reason")'),true);
 console.log('Appointment change Chrome passed: real booking and rescheduling, original reservation retained during outage, replacement persistence, reasoned cancellation under mobile review/attestation, Escape protection, released capacity and attributed history. Disposable synthetic fixtures cleaned.');
 }finally{socket?.close();browser.kill();}
 }finally{
 await db.query('DELETE FROM integration.staff_command WHERE organization_id=$1',[ids.organization]);
 await db.query("DELETE FROM integration.outbox WHERE aggregate_type='imaging_order' AND aggregate_id=$1",[x.order]);
 await db.query('DELETE FROM img.booking_arrival WHERE booking_id IN(SELECT id FROM img.schedule_booking WHERE order_id=$1)',[x.order]);
 await db.query('DELETE FROM img.schedule_reservation WHERE order_id=$1',[x.order]);await db.query('DELETE FROM img.booking_release WHERE booking_id IN(SELECT id FROM img.schedule_booking WHERE order_id=$1)',[x.order]);
 await db.query('DELETE FROM img.schedule_booking WHERE order_id=$1',[x.order]);await db.query('DELETE FROM img.schedule_slot WHERE resource_id=$1',[x.resource]);await db.query('DELETE FROM img.schedule_resource WHERE id=$1',[x.resource]);
 await db.query('DELETE FROM img.protocol_review WHERE order_id=$1',[x.order]);await db.query('DELETE FROM img.img_order WHERE id=$1',[x.order]);await db.query('DELETE FROM img.facility_protocol WHERE template_id=$1',[x.template]);await db.query('DELETE FROM img.protocol_template WHERE id=$1',[x.template]);await db.query('DELETE FROM img.procedure WHERE id=$1',[x.procedure]);await db.query('DELETE FROM encounter.encounter WHERE id=$1',[x.encounter]);await db.query('DELETE FROM patient.patient WHERE id=$1',[x.patient]);
 }
});
