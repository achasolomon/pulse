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
 await call('Page.navigate',{url:'http://localhost:3001/'});await until('document.querySelector(".workspace-tabs button")?.textContent==="Radiology"');await until('document.querySelector(".workspace-refresh")?.textContent.includes("Refresh")');
 assert.ok(Number(await evaluate('document.querySelector(".workspace-metric strong").textContent'))>=0);
 await call('Page.navigate',{url:'http://localhost:3001/worklists?queue=radiology'});await until('document.querySelector(".radiology-worklist .workspace-table") || document.querySelector(".radiology-worklist .workspace-empty h3")');assert.equal(await evaluate('document.querySelector(".sidebar__link--active").textContent'),'Radiology');assert.equal(await evaluate('document.querySelectorAll(".radiology-stages button").length'),6);
 if(await evaluate('Boolean(document.querySelector(".radiology-open"))')){await evaluate('document.querySelector(".radiology-open").click()');await until('document.querySelector(".radiology-detail h2")');assert.equal(await evaluate('document.querySelector(".radiology-detail").textContent.includes("Supplied safety context")'),true);const d=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/radiology-request-desktop.png',Buffer.from(d.data,'base64'));await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until('!document.querySelector(".radiology-detail")');}
 if(process.env.PULSE_REQUIRE_LOCAL_PACS==='yes')await until('document.querySelector(".radiology-pacs--connected")');
 const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/radiology-desktop.png',Buffer.from(shot.data,'base64'));
 await call('Network.setBlockedURLs',{urls:['*api/auth/radiology/queue*']});await evaluate('[...document.querySelectorAll(".workflow-toolbar button")].find(b=>b.textContent==="Refresh").click()');await until('document.querySelector(".radiology-worklist [role=alert]")');assert.equal(await evaluate('document.querySelector(".radiology-stages button span")'),null);
 await call('Network.setBlockedURLs',{urls:[]});await evaluate('[...document.querySelectorAll(".radiology-worklist button")].find(b=>b.textContent==="Retry").click()');await until('document.querySelector(".radiology-worklist .workspace-table") || document.querySelector(".radiology-worklist .workspace-empty h3")');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(300);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const m=await call('Page.captureScreenshot',{format:'png'});await writeFile('tmp/clinical-notes-evidence/radiology-mobile.png',Buffer.from(m.data,'base64'));
 assert.equal(await evaluate('fetch("/api/auth/radiology/queue",{method:"POST"}).then(r=>r.status)'),404);
 await evaluate('fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.status)');
 console.log('Radiology Chrome passed: role-specific workspace and sidebar, live queue and request detail, six stage filters, outage/retry, mobile layout and read-only proxy. No clinical records created.');
 }finally{socket?.close();browser.kill();}
