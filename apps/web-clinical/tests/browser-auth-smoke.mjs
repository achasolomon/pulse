import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStaffFixture } from "./live-auth-smoke.mjs";
import { totpAt } from "../../api/dist/modules/iam/domain/totp.js";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await withStaffFixture(
  async ({ db, ids, loginId, secret }) => {
    const profile = await mkdtemp(join(tmpdir(), "pulse-w02-browser-"));
    const browser = spawn(
      process.env.PULSE_BROWSER ??
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-port=9237",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    let socket;
    try {
      let pages;
      for (let i = 0; i < 50; i++) {
        try {
          pages = await (await fetch("http://127.0.0.1:9237/json/list")).json();
          if (pages.some((p) => p.type === "page")) break;
        } catch {}
        await delay(200);
      }
      assert.ok(pages?.length, "Browser debugging endpoint did not start");
      socket = new WebSocket(
        pages.find((p) => p.type === "page").webSocketDebuggerUrl,
      );
      await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
      });
      let id = 0;
      const pending = new Map();
      const browserErrors = [];
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
        if (msg.method === "Runtime.exceptionThrown")
          browserErrors.push(msg.params.exceptionDetails.text);
      };
      const cdp = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const current = ++id;
          pending.set(current, { resolve, reject });
          socket.send(JSON.stringify({ id: current, method, params }));
        });
      const evaluate = async (expression) => {
        const result = await cdp("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        assert.ok(!result.exceptionDetails, "Browser expression threw");
        return result.result.value;
      };
      const until = async (expression) => {
        for (let i = 0; i < 100; i++) {
          if (await evaluate(expression)) return;
          await delay(100);
        }
        console.log(
          "Browser timeout state:",
          await evaluate(
            "JSON.stringify({path:location.pathname,error:document.querySelector('.account-security [role=alert]')?.textContent,dialog:!!document.querySelector('.facility-dialog[open]')})",
          ),
        );
        assert.fail(`Browser condition timed out: ${expression}`);
      };
      const fill = async (selector, value) =>
        evaluate(
          `(() => {const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
      await cdp("Page.enable");
      await cdp("Runtime.enable");
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp("Page.navigate", { url: "http://localhost:3017/login" });
      await until(
        "document.querySelector('#login-id') && document.readyState==='complete'",
      );
      await delay(300);
      await mkdir("tmp/w02-evidence", { recursive: true });
      const capture = async (name, fullPage = false) => {
        const metrics = fullPage
          ? (await cdp("Page.getLayoutMetrics")).cssContentSize
          : undefined;
        const shot = await cdp("Page.captureScreenshot", {
          format: "png",
          ...(metrics
            ? {
                captureBeyondViewport: true,
                clip: {
                  x: 0,
                  y: 0,
                  width: metrics.width,
                  height: metrics.height,
                  scale: 1,
                },
              }
            : {}),
        });
        await writeFile(
          `tmp/w02-evidence/${name}.png`,
          Buffer.from(shot.data, "base64"),
        );
      };
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      assert.equal(
        await evaluate("document.querySelector('#login-secret').type"),
        "password",
      );
      await capture("login-desktop");
      await evaluate("document.querySelector('.auth-help summary').click()");
      assert.ok(
        await evaluate(
          "document.querySelector('.auth-help').open && document.querySelector('.auth-help').innerText.includes('reset your password')",
        ),
      );
      await evaluate("document.querySelector('.auth-help summary').click()");
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await delay(100);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      await capture("login-mobile");
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 320,
        height: 568,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await delay(100);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      // Simulate text-only enlargement, including explicit pixel-sized controls.
      await evaluate(
        "document.querySelectorAll('.auth-entry h1, .auth-entry p, .auth-entry label, .auth-entry input, .auth-entry button, .auth-entry summary').forEach(e=>{e.dataset.originalFontSize=e.style.fontSize;e.style.fontSize=(parseFloat(getComputedStyle(e).fontSize)*2)+'px';})",
      );
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      await capture("login-mobile-large-text", true);
      await evaluate(
        "document.querySelectorAll('[data-original-font-size]').forEach(e=>{e.style.fontSize=e.dataset.originalFontSize;delete e.dataset.originalFontSize;})",
      );
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await fill("#login-id", loginId);
      const loginWindowStartedAt = Date.now();
      await fill("#login-secret", "incorrect-password");
      await evaluate(
        "document.querySelector('[aria-label=\"Show password\"]').click()",
      );
      await until("document.querySelector('#login-secret').type==='text'");
      await evaluate("document.querySelector('button[type=submit]').click()");
      await until(
        "!!document.querySelector('.auth-error') && document.activeElement.classList.contains('auth-error') && !document.querySelector('button[type=submit]').disabled",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('#login-secret').value==='' && document.querySelector('#login-secret').type==='password' && document.activeElement.classList.contains('auth-error')",
        ),
        true,
      );
      await fill("#login-id", loginId);
      await fill("#login-secret", secret);
      await evaluate("document.querySelector('button[type=submit]').click()");
      await until(
        "location.pathname==='/' && !!document.querySelector('.facility-dialog[open] #facility')",
      );
      await delay(200);
      assert.ok(
        await evaluate(
          `document.body.innerText.includes(${JSON.stringify(loginId)})`,
        ),
      );
      await evaluate(
        `(() => {const e=document.querySelector('#facility');e.value=${JSON.stringify(ids.facility)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await until(
        `document.querySelector('#facility')?.value===${JSON.stringify(ids.facility)} && !document.querySelector('.facility-form button').disabled`,
      );
      await capture("facility-desktop");
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await delay(100);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      await capture("facility-mobile", true);
      if (process.argv.includes("--facility-preview")) {
        console.log("Facility desktop/mobile preview passed.");
        return;
      }
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(100);
      await evaluate("document.querySelector('button[type=submit]').click()");
      await until(
        "location.pathname==='/' && !document.querySelector('.facility-dialog[open]') && !!document.querySelector('.topbar')",
      );
      await delay(300);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      assert.ok(
        await evaluate(
          "document.body.innerText.includes('W02 synthetic facility')",
        ),
      );
      assert.equal(
        await evaluate("document.cookie.includes('pulse_session')"),
        false,
      );
      assert.equal(
        await evaluate("localStorage.length+sessionStorage.length"),
        0,
      );
      await evaluate(
        `(()=>{const e=document.querySelector('#header-facility');e.value=${JSON.stringify(ids.otherFacility)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await until(
        `document.querySelector('#header-facility')?.value===${JSON.stringify(ids.otherFacility)} && document.querySelector('.topbar__user-role')?.textContent==='doctor' && !document.querySelector('#header-facility').disabled`,
      );
      await evaluate(
        `(()=>{const e=document.querySelector('#header-facility');e.value=${JSON.stringify(ids.facility)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await until(
        `document.querySelector('#header-facility')?.value===${JSON.stringify(ids.facility)} && document.querySelector('.topbar__user-role')?.textContent==='nurse' && !document.querySelector('#header-facility').disabled`,
      );
      await mkdir("tmp/w02-evidence", { recursive: true });
      const desktop = await cdp("Page.captureScreenshot", { format: "png" });
      await writeFile(
        "tmp/w02-evidence/workspace-desktop.png",
        Buffer.from(desktop.data, "base64"),
      );
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await delay(200);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
        "Mobile horizontal overflow",
      );
      await evaluate(
        "document.querySelector('[aria-label=\"Open navigation\"]').focus();document.querySelector('[aria-label=\"Open navigation\"]').click()",
      );
      await delay(100);
      assert.equal(
        await evaluate(
          "document.querySelector('.main').inert && document.querySelector('.sidebar').contains(document.activeElement)",
        ),
        true,
      );
      await cdp("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await delay(100);
      assert.equal(
        await evaluate(
          "!document.querySelector('.main').inert && document.activeElement.getAttribute('aria-label')==='Open navigation'",
        ),
        true,
      );
      const mobile = await cdp("Page.captureScreenshot", { format: "png" });
      await writeFile(
        "tmp/w02-evidence/workspace-mobile.png",
        Buffer.from(mobile.data, "base64"),
      );
      await cdp("Page.navigate", {
        url: "http://localhost:3017/account/security",
      });
      await until("!!document.querySelector('#manage-mfa:not([disabled])')");
      await evaluate("document.querySelector('#manage-mfa').click()");
      await until(
        "!!document.querySelector('#mfa-password') && document.readyState==='complete' && !document.querySelector('#mfa-password').closest('form').querySelector('button').disabled",
      );
      await fill("#mfa-password", secret);
      await evaluate(
        "document.querySelector('#mfa-password').closest('form').querySelector('button').click()",
      );
      await until("!!document.querySelector('.security-setup-key')");
      const setupKey = await evaluate(
        "document.querySelector('.security-setup-key').textContent",
      );
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let bits = 0,
        value = 0;
      const keyBytes = [];
      for (const char of setupKey) {
        value = (value << 5) | alphabet.indexOf(char);
        bits += 5;
        if (bits >= 8) {
          bits -= 8;
          keyBytes.push((value >>> bits) & 255);
        }
      }
      const mfaSecret = Buffer.from(keyBytes).toString("base64");
      await fill("#setup-code", totpAt(mfaSecret));
      await evaluate(
        "document.querySelector('#setup-code').closest('form').querySelector('button').click()",
      );
      await until(
        "location.pathname==='/login' && !!document.querySelector('#login-id')",
      );
      await delay(200);
      await fill("#login-id", loginId);
      await fill("#login-secret", secret);
      await evaluate("document.querySelector('button[type=submit]').click()");
      await until(
        "!!document.querySelector('#login-totp') && document.activeElement.id==='login-totp' && !document.querySelector('button[type=submit]').disabled",
      );
      assert.equal(
        await evaluate(
          "document.activeElement.id==='login-totp' && !document.querySelector('#login-secret')",
        ),
        true,
      );
      await capture("login-mfa");
      await evaluate("document.querySelector('.auth-account button').click()");
      await until(
        "!!document.querySelector('#login-secret') && document.activeElement.id==='login-id'",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('#login-secret').value==='' && document.activeElement.id==='login-id'",
        ),
        true,
      );
      await fill("#login-secret", secret);
      await evaluate("document.querySelector('button[type=submit]').click()");
      await until("!!document.querySelector('#login-totp')");
      // Deterministically reject a code outside the accepted current/skew window.
      const codes = new Set(
        [-30_000, 0, 30_000].map((offset) =>
          totpAt(mfaSecret, Date.now() + offset),
        ),
      );
      const invalidCode = ["000000", "111111", "222222", "333333"].find(
        (code) => !codes.has(code),
      );
      await fill("#login-totp", invalidCode);
      await evaluate("document.querySelector('button[type=submit]').click()");
      await until("!!document.querySelector('.auth-error')");
      assert.equal(
        await evaluate(
          "!!document.querySelector('#login-totp') && document.querySelector('#login-totp').value===''",
        ),
        true,
      );
      // This walkthrough exercises six attempts. Respect the real API's five
      // attempts/minute policy instead of disabling the production safeguard.
      const remainingWindowMs = Math.max(
        0,
        61_000 - (Date.now() - loginWindowStartedAt),
      );
      if (remainingWindowMs) {
        console.log(
          "Waiting for the login throttle window before the final MFA retry.",
        );
        await delay(remainingWindowMs);
      }
      await fill("#login-totp", totpAt(mfaSecret));
      await evaluate("document.querySelector('button[type=submit]').click()");
      await until(
        "location.pathname==='/' && !!document.querySelector('.facility-dialog[open] #facility')",
      );
      await delay(200);
      await db.query(
        "UPDATE iam.membership SET effective_to=now() WHERE person_id=$1",
        [ids.person],
      );
      await cdp("Page.navigate", {
        url: "http://localhost:3017/",
      });
      await until(
        "document.body.innerText.includes('No active facility access')",
      );
      assert.equal(
        await evaluate(
          "!document.querySelector('#facility') && !Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Open workspace')",
        ),
        true,
      );
      await capture("facility-no-access");
      await evaluate(
        "Array.from(document.querySelector('.facility-dialog[open]').querySelectorAll('button')).find(b=>b.textContent==='Sign out').click()",
      );
      await until("location.pathname==='/login'");
      assert.equal(browserErrors.length, 0, "Uncaught browser errors");
      console.log(
        "Chrome smoke passed: login desktop/mobile/reflow, password visibility/reset, help, error focus, real login/facility/logout, httpOnly/storage, drawer focus/Escape and MFA success/invalid-code recovery. Screenshots: tmp/w02-evidence/.",
      );
    } finally {
      socket?.close();
      browser.kill();
    }
  },
  { twoFacilities: true },
);
