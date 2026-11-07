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
 for(const role of ['doctor','nurse','lab']){
  await call('Page.navigate',{url:'http://localhost:3001/login'});await until('document.querySelector("#login-id")');
  const status=await evaluate('(async()=>{const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify('+JSON.stringify({loginId:'demo.'+role,secret:credentials.secret})+')});if(!r.ok)return r.status;const s=await r.json();return(await fetch("/api/auth/facility",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({facilityId:s.facilities.find(f=>f.facilityCode==="LOCAL-CGH").facilityId})})).status;})()');assert.equal(status,200);
  await call('Page.navigate',{url:'http://localhost:3001/'});await until('document.querySelector(".workspace-dashboard")');await until('document.querySelector(".workspace-refresh")?.textContent.includes("Refresh")');
  const labels=await evaluate('[...document.querySelectorAll(".workspace-tabs button")].map(b=>b.textContent)');assert.deepEqual(labels,role==='doctor'?['Consultations']:role==='nurse'?['Nursing & vitals']:['Laboratory']);
  assert.equal(await evaluate('document.querySelectorAll(".workspace-metric strong").length'),role==='nurse'?2:3);
  assert.equal(await evaluate('Boolean(document.querySelector(".workspace-empty h3")?.textContent.includes("could not refresh"))'),false);
  const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/workspace-'+role+'-desktop.png',Buffer.from(shot.data,'base64'));
  if(role==='nurse'){
   await call('Network.setBlockedURLs',{urls:['*api/auth/visits*']});await evaluate('document.querySelector(".workspace-refresh").click()');await until('document.querySelector(".workspace-empty h3")?.textContent.includes("could not refresh")');assert.equal(await evaluate('document.querySelector(".workspace-metric strong").textContent'),'\u2014');
   await call('Network.setBlockedURLs',{urls:[]});await evaluate('document.querySelector(".workspace-refresh").click()');await until('document.querySelector(".workspace-refresh")?.textContent.includes("Refresh")');assert.equal(await evaluate('Boolean(document.querySelector(".workspace-empty h3")?.textContent.includes("could not refresh"))'),false);
   await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(300);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const m=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/workspace-nurse-mobile.png',Buffer.from(m.data,'base64'));await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  }
  await evaluate('fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.status)');
 }
 console.log('Workspace Chrome passed: doctor/nurse/laboratory role panels, live summary loading, outage/retry, mobile overflow and desktop/mobile screenshots. No clinical records created.');
 }finally{socket?.close();browser.kill();}
