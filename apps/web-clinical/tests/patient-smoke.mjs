import { randomUUID } from "node:crypto";
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
    ["patient:read", "observation:read", "entry:read"],
    ids.membership,
  ]);

  const patientIds = [];
  async function createPatient(name, fac = ids.facility) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO patient.patient(id,given_name,family_name,date_of_birth,sex,facility_id) VALUES($1,$2,$3,$4,$5,$6)",
      [id, "Synthetic", name, "1990-01-15", "F", fac],
    );
    patientIds.push(id);
    return id;
  }
  const patientA = await createPatient("Adeyemi");
  const patientB = await createPatient("Bello");
  for (let i = 0; i < 25; i++) await createPatient("Worklist-" + i);
  await db.query(
    "INSERT INTO patient.identifier(patient_id,system,value,facility_id) VALUES($1,$2,$3,$4)",
    [patientA, "urn:pulse:mrn:" + ids.facility, "READ-0001", ids.facility],
  );
  await db.query(
    "INSERT INTO iam.care_assignment(patient_id,person_id,facility_id,kind) VALUES($1,$2,$3,$4),($5,$2,$3,$4)",
    [patientA, ids.person, ids.facility, "attending", patientB],
  );
  await db.query(
    "INSERT INTO clin.observation(patient_id,code,value_num,unit,taken_at) VALUES($1,$2,$3,$4,$5)",
    [patientA, "heart-rate", 72, "bpm", "2026-10-14T09:00:00Z"],
  );
  await db.query(
    "INSERT INTO clin.entry(patient_id,kind,display) VALUES($1,$2,$3)",
    [patientA, "allergy", "Penicillin"],
  );
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

    await call("Page.navigate", { url: base + "/patients" });
    await until(
      'document.querySelectorAll(".patient-table tbody tr").length===25',
    );
    await mkdir("tmp/patient-evidence", { recursive: true });
    const screenshot = async (name) => {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(
        "tmp/patient-evidence/" + name + ".png",
        Buffer.from(shot.data, "base64"),
      );
    };
    await screenshot("worklist-desktop");
    await evaluate(
      'document.querySelectorAll(".patient-pagination button")[1].click()',
    );
    await until(
      'document.querySelectorAll(".patient-table tbody tr").length===2',
    );
    const fill = async (selector, value) =>
      evaluate(
        "(()=>{const el=document.querySelector(" +
          JSON.stringify(selector) +
          ');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,' +
          JSON.stringify(value) +
          ');el.dispatchEvent(new Event("input",{bubbles:true}));})()',
      );
    await fill(".patient-search input", "READ-0001");
    await until(
      'document.querySelectorAll(".patient-table tbody tr").length===1',
    );
    assert.ok(
      await evaluate(
        'document.querySelector(".patient-table").textContent.includes("Adeyemi")',
      ),
    );
    assert.equal(await evaluate("location.search"), "");
    await evaluate('document.querySelector(".patient-name").click()');
    await until('!!document.querySelector(".patient-chart")');
    assert.ok(
      await evaluate(
        'document.querySelector(".record-header").textContent.includes("Born 15 Jan 1990")',
      ),
    );
    assert.ok(
      await evaluate(
        'document.querySelector(".record-safety").textContent.includes("Penicillin")',
      ),
    );
    assert.ok(
      await evaluate(
        'document.querySelector(".chart-observations").textContent.includes("72 bpm")',
      ),
    );
    await screenshot("chart-desktop");
    await call("Page.navigate", { url: base + "/patients/" + patientB });
    await until(
      'document.querySelector(".record-header")?.textContent.includes("Bello")',
    );
    assert.ok(
      await evaluate(
        'document.querySelector(".record-safety").textContent.includes("confirm status")',
      ),
    );
    assert.equal(
      await evaluate(
        'document.querySelector(".patient-chart").textContent.includes("Penicillin")',
      ),
      false,
    );
    await until('!!document.querySelector(".record-contact-summary")');
    await fill(".workspace-search input", "Adeyemi");
    await evaluate('document.querySelector(".workspace-search input").focus()');
    await until('!!document.querySelector(".workspace-search__patients a")');
    await evaluate(
      'document.querySelector(".workspace-search__patients a").click()',
    );
    await until(
      'document.querySelector(".record-header")?.textContent.includes("Adeyemi")',
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
    await screenshot("chart-mobile");
    await call("Page.navigate", { url: base + "/patients" });
    await until('!!document.querySelector(".patient-table")');
    assert.equal(
      await evaluate("document.documentElement.scrollWidth===innerWidth"),
      true,
    );
    await screenshot("worklist-mobile");
    await call("Network.enable");
    await call("Network.setBlockedURLs", { urls: ["*/api/auth/patients/*"] });
    await fill(".patient-search input", "Missing");
    await until('!!document.querySelector(".patient-worklist [role=alert]")');
    assert.equal(
      await evaluate(
        'document.querySelectorAll(".patient-table tbody tr").length',
      ),
      0,
    );
    await call("Network.setBlockedURLs", { urls: [] });
    await evaluate(
      'document.querySelector(".patient-worklist__message button").click()',
    );
    await until('!!document.querySelector(".patient-worklist__empty")');
    assert.equal(
      await evaluate(
        'document.querySelector(".patient-worklist [role=alert]")===null',
      ),
      true,
    );
    const unassigned = patientIds[2];
    await call("Page.navigate", { url: base + "/patients/" + unassigned });
    await until('!!document.querySelector(".content [role=alert]")');
    assert.equal(
      await evaluate('document.querySelector(".record-header")===null'),
      true,
    );
    assert.equal(await evaluate("localStorage.length"), 0);
    console.log(
      "Patient browser smoke passed: worklist pagination, exact MRN search, chart identity/units/allergies, clean patient navigation, header search, care denial, mobile widths and outage recovery.",
    );
  } finally {
    socket?.close();
    browser.kill();
    await db.query(
      "DELETE FROM clin.observation WHERE patient_id=ANY($1::uuid[])",
      [patientIds],
    );
    await db.query("DELETE FROM clin.entry WHERE patient_id=ANY($1::uuid[])", [
      patientIds,
    ]);
    await db.query(
      "DELETE FROM iam.care_assignment WHERE patient_id=ANY($1::uuid[])",
      [patientIds],
    );
    await db.query(
      "DELETE FROM patient.identifier WHERE patient_id=ANY($1::uuid[])",
      [patientIds],
    );
    await db.query("DELETE FROM patient.patient WHERE id=ANY($1::uuid[])", [
      patientIds,
    ]);
  }
});
