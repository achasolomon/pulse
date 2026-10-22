import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSecret } from "../../api/dist/modules/iam/domain/credentials.js";
import { withStaffFixture } from "./live-auth-smoke.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base = "http://localhost:3018";
await withStaffFixture(async ({ db, ids, loginId, secret }) => {
  const actors = [
    {
      role: "records",
      person: ids.person,
      loginId,
      privileges: ["patient:read", "patient:write"],
    },
    {
      role: "reception",
      person: randomUUID(),
      loginId: `flow-reception-${randomUUID()}`,
      privileges: [
        "patient:read",
        "appointment:read",
        "appointment:check-in",
        "encounter:read",
        "encounter:write",
      ],
    },
    {
      role: "nurse",
      person: randomUUID(),
      loginId: `flow-nurse-${randomUUID()}`,
      privileges: [
        "patient:read",
        "observation:read",
        "observation:write",
        "entry:read",
        "encounter:read",
      ],
    },
    {
      role: "doctor",
      person: randomUUID(),
      loginId: `flow-doctor-${randomUUID()}`,
      privileges: [
        "patient:read",
        "observation:read",
        "entry:read",
        "encounter:read",
        "encounter:consult",
      ],
    },
  ];
  await db.query(
    "UPDATE iam.membership SET roles=$1,privileges=$2 WHERE id=$3",
    [["records"], actors[0].privileges, ids.membership],
  );
  for (const actor of actors.slice(1)) {
    await db.query(
      "INSERT INTO iam.credential(person_id,login_id,secret_hash)VALUES($1,$2,$3)",
      [actor.person, actor.loginId, hashSecret(secret)],
    );
    await db.query(
      "INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,$4,$5)",
      [
        actor.person,
        ids.organization,
        ids.facility,
        [actor.role],
        actor.privileges,
      ],
    );
  }
  const profile = await mkdtemp(join(tmpdir(), "pulse-flow-browser-"));
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
    for (let n = 0; n < 50; n++) {
      try {
        pages = await (await fetch("http://127.0.0.1:9249/json")).json();
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
        pending.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
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
    const navigate = async (path) => {
      await call("Page.navigate", { url: base + path });
    };
    const click = async (text) => {
      await until(
        `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`,
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`,
      );
    };
    const fill = async (name, value) => {
      await until(`document.querySelector('[name=${JSON.stringify(name)}]')`);
      return evaluate(
        `(()=>{const el=document.querySelector('[name=${JSON.stringify(name)}]');const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    };
    const login = async (actor) => {
      await navigate("/login");
      await until('document.querySelector("#login-id")');
      const result = await evaluate(
        `(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ loginId: actor.loginId, secret })})});if(!r.ok)return {status:r.status};const f=await fetch('/api/auth/facility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({facilityId:${JSON.stringify(ids.facility)}})});return {status:f.status};})()`,
      );
      assert.equal(result.status, 200);
    };
    await mkdir("tmp/outpatient-evidence", { recursive: true });
    const screenshot = async (name) => {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `tmp/outpatient-evidence/${name}.png`,
        Buffer.from(shot.data, "base64"),
      );
    };
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await login(actors[0]);
    await navigate("/patients");
    await click("Register patient");
    await fill("givenName", "Synthetic");
    await fill("familyName", "BrowserFlow");
    await fill("dateOfBirth", "1990-01-15");
    await fill("sex", "F");
    await screenshot("registration-desktop");
    await click("Create patient record");
    await until(
      'document.querySelectorAll(".patient-table tbody tr").length===1',
    );
    const patient = (
      await db.query("SELECT id FROM patient.patient WHERE facility_id=$1", [
        ids.facility,
      ])
    ).rows[0].id;
    assert.equal(
      await evaluate('document.querySelector(".settings-drawer[open]")===null'),
      true,
    );
    assert.equal(
      await evaluate("location.search"),
      "",
      "No MRN in navigation URL",
    );
    assert.equal(
      await evaluate('document.body.innerText.includes("Check in")'),
      false,
      "Records account has no receptionist command",
    );
    await login(actors[1]);
    await navigate("/patients");
    await click("Check in");
    await click("Confirm check-in");
    await until(
      'document.querySelector(".workflow-form")?.textContent.includes("Checked in")',
    );
    await screenshot("check-in-desktop");
    await navigate("/worklists");
    await until(
      'document.querySelector(".patient-table")?.textContent.includes("Waiting for vitals")',
    );
    await login(actors[2]);
    await navigate("/worklists");
    await click("Start vitals");
    await until(
      'document.querySelector(".settings-drawer[open] input[name=heart-rate]")',
    );
    await fill("heart-rate", "72");
    await fill("bp-systolic", "120");
    await fill("bp-diastolic", "80");
    await fill("temperature", "36.8");
    await screenshot("vitals-desktop");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(200);
    assert.equal(
      await evaluate("document.documentElement.scrollWidth===innerWidth"),
      true,
    );
    await screenshot("vitals-mobile");
    const bounds = await evaluate(
      '(()=>{const r=document.querySelector(".settings-drawer").getBoundingClientRect();return {left:r.left,bottom:r.bottom,width:r.width};})()',
    );
    assert.ok(
      bounds.left >= -1 &&
        bounds.width <= 391 &&
        Math.abs(bounds.bottom - 844) < 2,
      "Mobile bottom drawer",
    );
    await click("Save vitals");
    await until(
      'document.querySelector(".patient-table")?.textContent.includes("Vitals recorded")',
    );
    await until('!document.querySelector(".settings-drawer[open]")');
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(`/patients/${patient}`);
    await until(
      'document.querySelector(".chart-observations")?.textContent.includes("72 bpm")',
    );
    await until(
      'document.querySelector(".patient-chart")?.textContent.includes("Vitals recorded")',
    );
    await screenshot("nurse-chart");
    await navigate("/worklists");
    await click("Send to consultation");
    await until(
      'document.querySelector("select[name=clinicianId]")?.options.length===2',
    );
    await fill("clinicianId", actors[3].person);
    await screenshot("handoff-desktop");
    await click("Confirm handoff");
    await until('document.querySelector(".patient-worklist__empty")');
    await login(actors[3]);
    await navigate("/worklists");
    await until(
      'document.querySelector(".patient-table")?.textContent.includes("Waiting for consultation")',
    );
    await screenshot("consultation-queue");
    await click("Start consultation");
    await until(
      'document.querySelector(".patient-chart")?.textContent.includes("In consultation")',
    );
    assert.ok(
      await evaluate(
        'document.querySelector(".chart-observations").textContent.includes("36.8")',
      ),
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM clin.observation WHERE patient_id=$1",
          [patient],
        )
      ).rows[0].count,
      "4",
    );
    console.log(
      "Chrome passed: records registration â†’ receptionist check-in â†’ nurse claim, desktop/mobile vitals drawer and chart â†’ explicit clinician handoff â†’ assigned consultation queue and chart.",
    );
  } finally {
    socket?.close();
    browser.kill();
    await db.query(
      "DELETE FROM encounter.outpatient_visit_history WHERE visit_id IN (SELECT id FROM encounter.outpatient_visit WHERE facility_id=$1)",
      [ids.facility],
    );
    await db.query(
      "DELETE FROM encounter.outpatient_visit WHERE facility_id=$1",
      [ids.facility],
    );
    await db.query(
      "DELETE FROM integration.staff_command WHERE facility_id=$1",
      [ids.facility],
    );
    await db.query(
      "DELETE FROM clin.observation WHERE patient_id IN (SELECT id FROM patient.patient WHERE facility_id=$1)",
      [ids.facility],
    );
    await db.query("DELETE FROM iam.care_assignment WHERE facility_id=$1", [
      ids.facility,
    ]);
    await db.query("DELETE FROM encounter.encounter WHERE facility_id=$1", [
      ids.facility,
    ]);
    await db.query("DELETE FROM patient.identifier WHERE facility_id=$1", [
      ids.facility,
    ]);
    await db.query("DELETE FROM patient.patient WHERE facility_id=$1", [
      ids.facility,
    ]);
    for (const actor of actors.slice(1)) {
      await db.query(
        "DELETE FROM iam.session WHERE credential_id IN(SELECT id FROM iam.credential WHERE person_id=$1)",
        [actor.person],
      );
      await db.query("DELETE FROM iam.credential WHERE person_id=$1", [
        actor.person,
      ]);
      await db.query("DELETE FROM iam.membership WHERE person_id=$1", [
        actor.person,
      ]);
    }
  }
});
