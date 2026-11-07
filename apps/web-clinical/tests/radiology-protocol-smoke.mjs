import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const credentials=JSON.parse(await readFile('tmp/local-role-credentials.json','utf8'));
const profile=await mkdtemp(join(tmpdir(),'pulse-workspace-'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const browser = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=9263",
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
        pages = await (await fetch("http://127.0.0.1:9263/json")).json();
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

 await call('Page.navigate',{url:'http://localhost:3001/login'});await until('document.querySelector("#login-id")');
 const status=await evaluate('(async()=>{const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify('+JSON.stringify({loginId:'demo.radiology',secret:credentials.secret})+')});if(!r.ok)return r.status;const s=await r.json();return(await fetch("/api/auth/facility",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({facilityId:s.facilities.find(f=>f.facilityCode==="LOCAL-CGH").facilityId})})).status;})()');assert.equal(status,200);

 await call('Page.navigate',{url:'http://localhost:3001/worklists?queue=radiology'});await until('document.querySelector(".radiology-open")');await evaluate('document.querySelector(".radiology-open").click()');await until('document.querySelector(".radiology-detail h2")');
 const click=async text=>{await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+').click()');await delay(100);};
 const set=async(name,value)=>{const selector=JSON.stringify('[name="'+name+'"]');await evaluate('(()=>{const el=document.querySelector('+selector+');Object.getOwnPropertyDescriptor(el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));})()');};
 await click('Review protocol & screening');await until('document.querySelector("[name=imagingProtocolTemplate] option:nth-child(2)")');
 const template=await evaluate('document.querySelector("[name=imagingProtocolTemplate] option:nth-child(2)").value');await set('imagingProtocolTemplate',template);await until('document.querySelector("[name=screen-identity]")');
 await set('screen-identity','unknown');await set('evidence-identity','Synthetic UI review only; not submitted');await set('screen-policy','clear');await set('protocolReason','Synthetic UI hold rationale; not submitted');
 await set('protocolDecision','approved');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review decision").disabled'),true);
 await set('protocolDecision','hold');await click('Review decision');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Confirm decision").disabled'),true);
 await evaluate('document.querySelector("[name=protocolAttestation]").click()');
 const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/protocol-review-desktop.png',Buffer.from(shot.data,'base64'));
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/orders/*/protocol-reviews']});await click('Confirm decision');await until('document.querySelector(".protocol-form [role=alert]")');assert.equal(await evaluate('document.querySelector(".protocol-form").textContent.includes("Synthetic UI hold rationale")'),true);
 await click('Back');assert.equal(await evaluate('document.querySelector("[name=protocolReason]").value'),'Synthetic UI hold rationale; not submitted');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('document.body.textContent.includes("Discard this unsaved review?")');await click('Keep editing');assert.equal(await evaluate('document.querySelector("[name=protocolReason]").value'),'Synthetic UI hold rationale; not submitted');const mobile=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/protocol-form-mobile.png',Buffer.from(mobile.data,'base64'));
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('document.body.textContent.includes("Discard this unsaved review?")');await click('Discard changes');await until('!document.querySelector(".protocol-form")');await call('Network.setBlockedURLs',{urls:[]});
 await evaluate('fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.status)');
 console.log('Protocol Chrome passed: template and configured screening, unresolved approval block, reviewed hold/attestation, blocked-save retention, mobile Escape/discard protection. Submission blocked: no clinical review recorded on normal database.');
 }finally{socket?.close();browser.kill();}
