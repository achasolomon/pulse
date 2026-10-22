"use client";
import { useEffect, useRef, useState } from "react";
import { createStaffWebApi, type OutpatientVisit, type StaffChartOverview, type StaffChartSection, type StaffChartHistoryPage } from "@pulse/api-client";
import { RecordIcon } from "./record-icon.js";
import { stageLabels } from "./visit-actions.js";
const api = createStaffWebApi();

export function PatientRecordHeader({ chart, facilityName, privileges, onOpen, onDocument }: {
  chart: StaffChartOverview;
  facilityName: string;
  privileges: string[];
  onOpen: (section: StaffChartSection) => void;
  onDocument: () => void;
}) {
  const patient = chart.patient;
  const canReadVisit = privileges.includes("encounter:read");
  const canReadMeds = privileges.includes("medication:read");
  const [visit, setVisit] = useState<OutpatientVisit | null>(null);
  const [visitState, setVisitState] = useState("loading");
  const [meds, setMeds] = useState<StaffChartHistoryPage | null>(null);
  const [medsFailed, setMedsFailed] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (canReadVisit) api.currentVisit(patient.id, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setVisit(result); setVisitState("ready"); }
    }).catch(() => { if (!controller.signal.aborted) setVisitState("failed"); });
    if (canReadMeds) api.chartHistory(patient.id, "medications", undefined, controller.signal).then((result) => {
      if (!controller.signal.aborted) setMeds(result);
    }).catch(() => { if (!controller.signal.aborted) setMedsFailed(true); });
    return () => controller.abort();
  }, [patient.id, canReadVisit, canReadMeds]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) menu.current?.removeAttribute("open"); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && menu.current?.open) { menu.current.removeAttribute("open"); menu.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const allergies = chart.entries.items.filter((entry) => entry.kind === "allergy" && entry.status === "active");
  const allergySummary=chart.entries.allergySummary;
  const allergyCount=allergySummary?.count??allergies.length;
  const allergyText=allergyCount?(allergySummary?.substances??allergies.map(i=>i.display)).join(' · '):allergySummary?.status==='no-known-allergies'?'No known allergies':allergySummary?.status==='no-known-drug-allergies'?'No known drug allergies':'Allergy status unknown';
  const conditions = chart.entries.items.filter((entry) => entry.kind !== "allergy" && entry.status === "active");
  const activeMeds = meds?.items.filter((item) => ["prescribed", "verified", "dispensed", "held"].includes(item.status)) ?? [];
  const birth = new Date(patient.dateOfBirth), now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) years--;
  const open = (section: StaffChartSection) => { menu.current?.removeAttribute("open"); onOpen(section); };
  return <div className="patient-banner">
    <header className="patient-banner__top">
      <div className="patient-banner__avatar" aria-hidden="true">{patient.givenName[0]}{patient.familyName[0]}</div>
      <div className="patient-banner__identity">
        <div className="patient-banner__name"><h1>{patient.givenName} {patient.familyName}</h1><span className={`patient-banner__badge ${patient.status !== "active" ? "patient-banner__badge--merged" : ""}`}>{patient.status === "active" ? "Active record" : "Merged record"}</span></div>
        <div className="patient-banner__demographics"><span>MRN: <strong>{patient.mrn ?? "Not recorded"}</strong></span><span>{years < 1 ? "Under 1 year" : `${years} years`}</span><span>{{M: "Male", F: "Female", O: "Other", U: "Sex not recorded"}[patient.sex]}</span><span>{new Intl.DateTimeFormat("en-GB", {day: "2-digit", month: "short", year: "numeric"}).format(birth)}</span></div>
      </div>
      <div className="patient-banner__context">
        <div className="patient-banner__context-item"><span className="patient-banner__context-icon"><RecordIcon kind="facility" /></span><div><strong>{facilityName}</strong><small>Current facility</small></div></div>
        <div className="patient-banner__context-item"><span className="patient-banner__context-icon"><RecordIcon kind="visits" /></span><div><strong>{!canReadVisit ? "Restricted" : visitState === "loading" ? "Loading visit…" : visitState === "failed" ? "Visit unavailable" : visit ? "Outpatient" : "No active outpatient visit"}</strong><small>Visit type</small></div></div>
        {visit ? <div className="patient-banner__context-item patient-banner__visit-status"><span className="patient-banner__status-dot" /><div><strong>{stageLabels[visit.stage]}</strong><small>Visit status</small></div></div> : null}
      </div>
      <details className="patient-banner__actions" ref={menu}><summary>Actions <span aria-hidden="true">⌄</span></summary><div className="patient-banner__action-menu"><button onClick={() => open("profile")}><RecordIcon kind="patient" />Patient details</button>{privileges.includes("note:write") ? <button onClick={() => { menu.current?.removeAttribute("open"); onDocument(); }}><RecordIcon kind="notes" />New clinical note</button> : null}{canReadVisit ? <button onClick={() => open("visits")}><RecordIcon kind="visits" />Visit history</button> : null}{privileges.includes("document:read") ? <button onClick={() => open("documents")}><RecordIcon kind="documents" />Patient documents</button> : null}</div></details>
    </header>
    <div className="patient-banner__safety" aria-label="Patient safety summary">
      <button className={`patient-banner__tile ${allergyCount ? "patient-banner__tile--allergy" : ""} ${allergySummary?.highCriticality?'patient-banner__tile--critical':''}`} onClick={() => open("entries")}><span className="patient-banner__tile-icon"><RecordIcon kind="allergy" /></span><span><strong>Allergies{allergySummary?.highCriticality?' · High criticality':''}</strong><span>{chart.entries.access === "restricted" ? "Access restricted" : allergyText}</span><small>{chart.entries.access === "restricted" ? "Permission required" : allergyCount ? `${allergyCount} active · Review & reconcile` : allergySummary?.status?.startsWith('no-known')?'Explicit review recorded':'Confirm with patient'}</small></span></button>
      <button className="patient-banner__tile" onClick={() => open("medications")}><span className="patient-banner__tile-icon"><RecordIcon kind="medications" /></span><span><strong>Current medications</strong><span>{!canReadMeds ? "Access restricted" : medsFailed ? "Unable to load" : !meds ? "Loading…" : activeMeds.length ? activeMeds.slice(0, 2).map((item) => item.title).join(" · ") : "None in recent prescriptions"}</span><small>{canReadMeds ? "Review & reconcile medication history" : "Permission required"}</small></span></button>
      <button className="patient-banner__tile" onClick={() => open("entries")}><span className="patient-banner__tile-icon"><RecordIcon kind="entries" /></span><span><strong>Problems & diagnoses</strong><span>{chart.entries.access === "restricted" ? "Access restricted" : conditions.length ? conditions.slice(0, 2).map((entry) => `${entry.display} (${entry.verificationStatus ?? "verification not recorded"})`).join(" · ") : "None in recent entry summary"}</span><small>Review longitudinal history</small></span></button>
    </div>
  </div>;
}
