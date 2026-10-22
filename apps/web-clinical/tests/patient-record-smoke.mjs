import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStaffFixture } from "./live-auth-smoke.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await withStaffFixture(async ({ db, ids, loginId, secret }) => {
  const privileges = [
    "patient:read",
    "encounter:read",
    "observation:read",
    "entry:read",
    "note:read",
    "medication:read",
    "lab:read",
    "imaging:view",
    "document:read",
  ];
  await db.query("UPDATE iam.membership SET privileges=$1 WHERE id=$2", [
    privileges,
    ids.membership,
  ]);
  const patient = (
    await db.query(
      "INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id,contact_phone,contact_address)VALUES('Synthetic Ada','Adeyemi','1990-01-15','F',$1,'000-000-0000','Synthetic test address')RETURNING id",
      [ids.facility],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO patient.identifier(patient_id,facility_id,system,value)VALUES($1,$2,$3,'CHART-001')",
    [patient, ids.facility, "urn:pulse:mrn:" + ids.facility],
  );
  await db.query(
    "INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,kind)VALUES($1,$2,$3,'chart-review')",
    [ids.person, patient, ids.facility],
  );
  const visits = [];
  for (const [month, type] of [
    [1, "outpatient"],
    [2, "inpatient"],
    [3, "outpatient"],
  ])
    visits.push(
      (
        await db.query(
          "INSERT INTO encounter.encounter(patient_id,facility_id,type,status,started_at,ended_at,disposition)VALUES($1,$2,$3,'discharged',$4,$5,'Follow-up arranged')RETURNING id",
          [
            patient,
            ids.facility,
            type,
            `2026-0${month}-14T09:00:00Z`,
            `2026-0${month}-14T10:00:00Z`,
          ],
        )
      ).rows[0].id,
    );
  const encounter = visits[2];
  await db.query(
    "INSERT INTO clin.entry(patient_id,encounter_id,kind,display,status)VALUES($1,$2,'allergy','Synthetic: Penicillin allergy','active'),($1,$2,'problem','Synthetic: Hypertension','active'),($1,$3,'diagnosis','Synthetic: Prior respiratory illness','resolved')",
    [patient, encounter, visits[0]],
  );
  for (const [code, value, unit] of [
    ["heart-rate", 72, "bpm"],
    ["bp-systolic", 120, "mmHg"],
    ["bp-diastolic", 80, "mmHg"],
    ["temperature", 36.8, "°C"],
    ["spo2", 98, "%"],
    ["respiratory-rate", 16, "breaths/min"],
  ])
    await db.query(
      "INSERT INTO clin.observation(patient_id,encounter_id,code,value_num,unit,recorded_by)VALUES($1,$2,$3,$4,$5,$6)",
      [patient, encounter, code, value, unit, ids.person],
    );
  const note = (
    await db.query(
      "INSERT INTO clin.note(patient_id,encounter_id,author_id,chief_complaint,history,examination,assessment,plan,status,signed_at)VALUES($1,$2,$3,'Synthetic follow-up consultation','Synthetic patient history retained across visits.','Synthetic examination findings.','Synthetic assessment.','Synthetic treatment plan and follow-up.','signed',now())RETURNING id",
      [patient, encounter, ids.person],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO clin.note_addendum(note_id,text)VALUES($1,'Synthetic addendum retained without replacing signed text.')",
    [note],
  );
  const medication = (
    await db.query(
      "INSERT INTO med.medication(code,name)VALUES($1,$2)RETURNING id",
      [randomUUID(), "Synthetic medication"],
    )
  ).rows[0].id;
  const prescription = (
    await db.query(
      "INSERT INTO med.request(patient_id,encounter_id,medication_id,dose,dose_unit,route,frequency,status)VALUES($1,$2,$3,'1','tablet','oral','once daily','completed')RETURNING id",
      [patient, encounter, medication],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO med.administration(request_id,dose_given,outcome)VALUES($1,'1 tablet','given')",
    [prescription],
  );
  await db.query(
    "INSERT INTO docs.document(patient_id,encounter_id,name,mime,storage_key)VALUES($1,$2,'Synthetic referral letter','application/pdf','private-key-not-visible')",
    [patient, encounter],
  );
  const profile = await mkdtemp(join(tmpdir(), "pulse-chart-browser-"));
  const browser = spawn(
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
    const click = async (text) => {
      await until(
        `[...document.querySelectorAll('button')].some(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(text)}&&!b.disabled)`,
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(text)}&&!b.disabled).click()`,
      );
      await delay(250);
    };
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await call("Page.navigate", { url: "http://localhost:3018/login" });
    await until('document.querySelector("#login-id:not([disabled])")');
    assert.equal(
      await evaluate(
        `(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ loginId, secret })})});if(!r.ok)return r.status;return(await fetch('/api/auth/facility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({facilityId:${JSON.stringify(ids.facility)}})})).status;})()`,
      ),
      200,
    );
    await call("Page.navigate", {
      url: `http://localhost:3018/patients/${patient}`,
    });
    await until(
      'document.querySelector(".record-contact-summary")?.textContent.includes("000-000-0000")',
    );
    await until(
      'document.querySelectorAll(".record-visit-list article").length===3',
    );
    await mkdir("tmp/patient-record-evidence", { recursive: true });
    const screenshot = async (name) => {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `tmp/patient-record-evidence/${name}.png`,
        Buffer.from(shot.data, "base64"),
      );
    };
    await screenshot("overview-desktop");
    await click("Visits & encounters");
    await until(
      'document.querySelectorAll(".record-visit-list article").length===3',
    );
    await evaluate(
      'document.querySelector(".record-visit-list summary").click()',
    );
    await screenshot("visits-desktop");
    await click("Notes for this visit");
    await until('document.querySelector(".record-visit-filter")');
    await until('document.querySelector(".record-history-item summary")');
    await evaluate(
      'document.querySelector(".record-history-item summary").click()',
    );
    await until(
      'document.querySelector(".record-section").innerText.includes("Synthetic addendum retained")',
    );
    await screenshot("notes-desktop");
    await click("Medications & treatment");
    await until('document.querySelector(".record-history-item summary")');
    await evaluate(
      'document.querySelector(".record-history-item summary").click()',
    );
    await until(
      'document.querySelector(".record-section").innerText.includes("1 tablet")',
    );
    assert.ok(
      await evaluate(
        'document.querySelector(".record-section").innerText.includes("given")',
      ),
    );
    await screenshot("medications-desktop");
    await click("Patient details");
    await until(
      'document.querySelector(".record-section").innerText.includes("000-000-0000")',
    );
    assert.ok(
      await evaluate(
        'document.querySelector(".record-section").innerText.includes("Synthetic test address")',
      ),
    );
    await click("Documents");
    await until(
      'document.querySelector(".record-section").innerText.includes("Synthetic referral letter")',
    );
    assert.equal(
      await evaluate(
        'document.body.innerText.includes("private-key-not-visible")',
      ),
      false,
    );
    await click("Overview");
    await until('document.querySelector(".record-contact-summary")');
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(300);
    assert.equal(await evaluate("document.documentElement.scrollWidth"), 390);
    await screenshot("overview-mobile");
    await click("Vitals history");
    await until('document.querySelectorAll(".record-history-item").length===6');
    await evaluate("window.scrollTo(0,600)");
    await delay(150);
    assert.ok(
      await evaluate(
        'document.querySelector(".record-header").getBoundingClientRect().top>=0',
      ),
      "Patient identity remains visible",
    );
    await screenshot("vitals-mobile");
    await evaluate("window.scrollTo(0,0)");
    await click("Clinical notes");
    await until('document.querySelector(".record-history-item summary")');
    await evaluate(
      'document.querySelector(".record-history-item summary").click()',
    );
    assert.equal(
      await evaluate("document.documentElement.scrollWidth===innerWidth"),
      true,
    );
    await screenshot("notes-mobile");
    await db.query(
      "UPDATE iam.membership SET privileges=ARRAY['patient:read','encounter:read','observation:read','entry:read']WHERE id=$1",
      [ids.membership],
    );
    await call("Page.navigate", {
      url: `http://localhost:3018/patients/${patient}`,
    });
    await until('document.querySelector(".record-contact-summary")');
    await click("Clinical notes");
    await until(
      'document.querySelector(".record-section").innerText.includes("Access restricted")',
    );
    assert.equal(
      await evaluate(
        'document.querySelector(".record-section").innerText.includes("Synthetic treatment plan")',
      ),
      false,
    );
    console.log(
      "Patient record Chrome passed: rich overview, dated visit history, visit-filtered notes/addenda, treatment/administration history, contacts/documents, persistent identity, mobile widths and restricted sections.",
    );
  } finally {
    socket?.close();
    browser.kill();
    await db.query("DELETE FROM docs.document WHERE patient_id=$1", [patient]);
    await db.query("DELETE FROM med.administration WHERE request_id=$1", [
      prescription,
    ]);
    await db.query("DELETE FROM med.request WHERE id=$1", [prescription]);
    await db.query("DELETE FROM med.medication WHERE id=$1", [medication]);
    await db.query("DELETE FROM clin.note_addendum WHERE note_id=$1", [note]);
    await db.query("DELETE FROM clin.note WHERE patient_id=$1", [patient]);
    await db.query("DELETE FROM clin.entry WHERE patient_id=$1", [patient]);
    await db.query("DELETE FROM clin.observation WHERE patient_id=$1", [
      patient,
    ]);
    await db.query("DELETE FROM iam.care_assignment WHERE patient_id=$1", [
      patient,
    ]);
    await db.query("DELETE FROM encounter.encounter WHERE patient_id=$1", [
      patient,
    ]);
    await db.query("DELETE FROM patient.identifier WHERE patient_id=$1", [
      patient,
    ]);
    await db.query("DELETE FROM patient.patient WHERE id=$1", [patient]);
  }
});
