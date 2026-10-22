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
    await call("Page.navigate", { url: base + "/account/security" });
    await until('!!document.querySelector("#manage-mfa:not([disabled])")');
    assert.equal(
      await evaluate('document.querySelectorAll(".security-form").length'),
      0,
    );
    const screen = await call("Page.captureScreenshot", { format: "png" });
    await mkdir("tmp/security-evidence", { recursive: true });
    await writeFile(
      "tmp/security-evidence/desktop.png",
      Buffer.from(screen.data, "base64"),
    );
    await evaluate('document.querySelector("#manage-mfa").click()');
    await until('document.activeElement?.id==="mfa-password"');
    assert.equal(
      await evaluate(
        'document.querySelector(".settings-drawer[open]").getBoundingClientRect().right === innerWidth',
      ),
      true,
    );
    const drawerShot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(
      "tmp/security-evidence/desktop-drawer.png",
      Buffer.from(drawerShot.data, "base64"),
    );
    await evaluate(
      '(()=>{const el=document.querySelector("#mfa-password");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"incorrect-test-password");el.dispatchEvent(new Event("input",{bubbles:true}));})()',
    );
    await evaluate(
      'document.querySelector("#mfa-password").closest("form").querySelector("button").click()',
    );
    await until('!!document.querySelector(".settings-feedback [role=alert]")');
    assert.equal(
      await evaluate("document.activeElement.className"),
      "settings-feedback",
    );
    await evaluate(
      '(()=>{const el=document.querySelector("#mfa-password");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,' +
        JSON.stringify(secret) +
        ');el.dispatchEvent(new Event("input",{bubbles:true}));})()',
    );
    await evaluate(
      'document.querySelector("#mfa-password").closest("form").querySelector("button").click()',
    );
    await until('!!document.querySelector(".security-setup-key")');
    assert.ok(
      await evaluate(
        'document.querySelector(".security-setup-key").textContent.length>10',
      ),
    );
    await evaluate('document.querySelector(".settings-drawer__close").click()');
    await until('!document.querySelector(".security-form")');
    assert.equal(await evaluate("document.activeElement.id"), "manage-mfa");
    await evaluate('document.querySelector("#manage-email").click()');
    await until('document.activeElement?.id==="recovery-email"');
    await evaluate(
      '(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;for(const [id,value] of ' +
        JSON.stringify([
          ["recovery-email", "settings-test@pulse.test"],
          ["email-password", secret],
        ]) +
        '){const el=document.getElementById(id);set.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));}})()',
    );
    await evaluate(
      'document.querySelector("#email-password").closest("form").querySelector("button").click()',
    );
    await until('!!document.querySelector(".settings-feedback [role=status]")');
    assert.ok(
      await evaluate(
        'document.querySelector(".settings-feedback").textContent.includes("Verification link requested")',
      ),
    );
    assert.equal(
      await evaluate('document.querySelector("#email-password").value'),
      "",
    );
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await until(
      'document.querySelector(".sidebar").getBoundingClientRect().right<=0',
    );
    assert.equal(
      await evaluate("document.documentElement.scrollWidth===innerWidth"),
      true,
    );
    const mobile = await call("Page.captureScreenshot", { format: "png" });
    assert.equal(
      await evaluate(
        'document.querySelector(".settings-drawer[open]").getBoundingClientRect().bottom === innerHeight',
      ),
      true,
    );
    await writeFile(
      "tmp/security-evidence/mobile.png",
      Buffer.from(mobile.data, "base64"),
    );
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
    await until('!document.querySelector(".settings-drawer[open]")');
    assert.equal(await evaluate("document.activeElement.id"), "manage-email");
    console.log(
      "Account settings browser checks passed: collapsed settings rows, identity, focus, rejected reauthentication, actual MFA setup, cancel, recovery verification request and mobile layout.",
    );
  } finally {
    socket?.close();
    browser.kill();
  }
});
