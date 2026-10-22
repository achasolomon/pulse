import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStaffFixture } from "./live-auth-smoke.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base = "http://localhost:3018";
await withStaffFixture(async ({ db, ids, loginId, secret }) => {
  await db.query("UPDATE iam.membership SET privileges=$1 WHERE id=$2", [
    ["task:create"],
    ids.membership,
  ]);
  const profile = await mkdtemp(join(tmpdir(), "pulse-inbox-browser-"));
  const browser = spawn(
    process.env.PULSE_BROWSER ??
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
    for (let index = 0; index < 50; index++) {
      try {
        pages = await (await fetch("http://127.0.0.1:9249/json")).json();
        break;
      } catch {
        await delay(200);
      }
    }
    socket = new WebSocket(
      pages.find((page) => page.type === "page").webSocketDebuggerUrl,
    );
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiter = pending.get(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
        pending.delete(message.id);
      }
    };
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      assert.ok(!result.exceptionDetails, "Browser expression failed");
      return result.result.value;
    };
    const until = async (expression) => {
      for (let n = 0; n < 100; n++) {
        if (await evaluate(`(async()=>Boolean(await (${expression})))()`))
          return;
        await delay(200);
      }
      assert.fail(`Timed out: ${expression}`);
    };
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await call("Page.navigate", { url: base + "/login" });
    await until('!!document.querySelector("#login-id:not([disabled])")');
    await evaluate(
      '(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;for(const [id,value] of ' +
        JSON.stringify([
          ["login-id", loginId],
          ["login-secret", secret],
        ]) +
        '){const el=document.getElementById(id);set.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));}})()',
    );
    await evaluate('document.querySelector(".auth-submit").click()');
    await until(
      '!!document.querySelector(".facility-dialog[open] #facility:not([disabled])")',
    );
    await evaluate('document.querySelector("#facility").click()');
    await evaluate(
      'document.querySelector("#facility-list [role=option]").click()',
    );
    await evaluate('document.querySelector(".facility-form__submit").click()');
    await until('!!document.querySelector(".notification-bell")');
    await until(
      'document.querySelector(".notification-bell").getAttribute("aria-label")==="Notifications, 0 unread"',
    );
    assert.equal(
      await evaluate('document.querySelector("#header-facility")===null'),
      true,
      "Single hospital has no switcher",
    );
    const bff = await evaluate(
      '(async()=>{const response=await fetch("/api/auth/inbox/notifications");return {status:response.status,cache:response.headers.get("cache-control"),body:await response.json()};})()',
    );
    assert.equal(bff.status, 200);
    assert.ok(bff.cache.includes("no-store"));
    const login = await fetch("http://localhost:3048/api/v1/iam/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginId, secret }),
    });
    assert.equal(login.status, 201);
    const { token } = await login.json();
    const created = await fetch(
      "http://localhost:3048/api/v1/workflow/staff/tasks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-tenant-id": ids.organization,
          "x-facility-id": ids.facility,
        },
        body: JSON.stringify({
          kind: "Review shift handover",
          assigneeId: ids.person,
        }),
      },
    );
    assert.equal(created.status, 201);
    const task = await created.json();
    await until(
      '(async()=>{const r=await fetch("/api/auth/inbox/notifications");return r.ok && (await r.json()).unreadCount===1;})()',
    );
    await evaluate('window.dispatchEvent(new Event("pulse:inbox-refresh"))');
    await until(
      'document.querySelector(".notification-bell__count")?.textContent==="1"',
    );
    await evaluate(
      'document.querySelector(".notification-bell").focus();document.querySelector(".notification-bell").click()',
    );
    await until('document.querySelector(".notification-item a")');
    await mkdir("tmp/notification-evidence", { recursive: true });
    const shot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(
      "tmp/notification-evidence/header-inbox.png",
      Buffer.from(shot.data, "base64"),
    );
    await evaluate(
      'document.querySelector(".notification-item button").click()',
    );
    await until(
      'document.querySelector(".notification-item__read")?.textContent==="Read"',
    );
    assert.equal(
      (
        await db.query("SELECT status FROM workflow.task WHERE id=$1", [
          task.id,
        ])
      ).rows[0].status,
      "open",
    );
    await evaluate('document.querySelector(".notification-item a").click()');
    await until('document.body.textContent.includes("Review shift handover")');
    await call("Page.navigate", { url: base + "/notifications" });
    await until(
      '!!document.querySelector(".notification-centre--full .notification-item")',
    );
    await evaluate(
      'document.querySelectorAll(".notification-filters button")[1].click()',
    );
    await until(
      'document.querySelector(".notification-message")?.textContent.includes("caught up")',
    );
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await until(
      'document.querySelector(".sidebar").getBoundingClientRect().right <= 0',
    );
    assert.equal(
      await evaluate("document.documentElement.scrollWidth===innerWidth"),
      true,
    );
    const mobileShot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(
      "tmp/notification-evidence/mobile-inbox.png",
      Buffer.from(mobileShot.data, "base64"),
    );
    await call('Network.enable');
    await call('Network.setBlockedURLs', { urls: ['*/api/auth/inbox/notifications*'] });
    await evaluate('window.dispatchEvent(new Event("pulse:inbox-refresh"))');
    await until('!!document.querySelector(".notification-centre--full [role=alert]")');
    assert.equal(await evaluate('document.querySelector(".notification-bell").getAttribute("aria-label")'), 'Notifications unavailable');
    await call('Network.setBlockedURLs', { urls: [] });
    await evaluate('window.dispatchEvent(new Event("pulse:inbox-refresh"))');
    await until('!document.querySelector(".notification-centre--full [role=alert]")');
    console.log(
      "Notification browser smoke passed: live task event, automatic delivery, bell count, scoped BFF, read without completion, task link, unread filter, single-hospital header and mobile layout.",
    );
  } finally {
    socket?.close();
    browser.kill();
  }
});
