"use client";
import { useEffect, useState, useRef } from "react";
import { Alert, Button } from "@pulse/ui";
import {
  ApiError,
  createStaffWebApi,
  type StaffChartOverview,
  type StaffChartSection,
  type StaffChartHistoryPage,
} from "@pulse/api-client";
import { PatientActiveVisit } from "./patient-active-visit.js";
import { ClinicalNoteEditor } from "./clinical-note-editor.js";
import { LatestVitalSigns } from "./latest-vital-signs.js";
import { RecordIcon } from "./record-icon.js";
import { PatientRecordHeader } from "./patient-record-header.js";
import { ClinicalSummaryCards, DiagnosticFindings } from "./clinical-summary-cards.js";
import { RichNoteView } from "./rich-note-editor.js";
import {ProblemEntryDrawer} from './problem-entry-drawer.js';
import {AllergyRecordPanel,AllergyDrawer,type AllergyAction} from './allergy-workspace.js';
import {LabOrderDrawer} from './lab-order-drawer.js';
import {ImagingOrderDrawer} from './imaging-order-drawer.js';
import {useRouter} from 'next/navigation';
const api = createStaffWebApi();
const labels: Record<string, string> = {
  "blood-pressure": "Blood pressure",
  "heart-rate": "Heart rate",
  "respiratory-rate": "Respiratory rate",
  "bp-systolic": "Systolic BP",
  "bp-diastolic": "Diastolic BP",
  temperature: "Temperature",
  spo2: "Oxygen saturation",
  weight: "Weight",
  height: "Height",
};
const sections: {
  id: StaffChartSection | "overview";
  label: string;
  description: string;
  privileges: string[];
}[] = [
  {
    id: "overview",
    label: "Overview",
    description:
      "A summary of the patient’s current care and recorded clinical information.",
    privileges: ["patient:read"],
  },
  {
    id: "visits",
    label: "Visits & encounters",
    description:
      "Outpatient, inpatient and emergency encounters, newest first. Expand a visit to review its recorded context.",
    privileges: ["encounter:read"],
  },
  {
    id: "vitals",
    label: "Vitals history",
    description:
      "Measurements across visits, with their original units, measurement time and recording source.",
    privileges: ["observation:read"],
  },
  {
    id: "notes",
    label: "Clinical notes",
    description:
      "Signed consultation records, assessments and treatment plans, including addenda. Your own drafts are identified separately.",
    privileges: ["note:read"],
  },
  {
    id: "entries",
    label: "Problems & allergies",
    description:
      "Recorded allergies, problems and diagnoses, including resolved entries.",
    privileges: ["entry:read"],
  },
  {
    id: "medications",
    label: "Medications & treatment",
    description:
      "Prescription history and recent administration records. Prescription status does not confirm that a dose was taken.",
    privileges: ["medication:read"],
  },
  {
    id: "investigations",
    label: "Investigations",
    description:
      "Laboratory and imaging orders with recorded status, verified laboratory findings and final imaging reports. Unverified findings and draft reports are withheld.",
    privileges: ["lab:read", "imaging:view"],
  },
  {
    id: "documents",
    label: "Documents",
    description:
      "Documents registered against the patient or an encounter. This register shows metadata; file viewing is separate.",
    privileges: ["document:read"],
  },
  {
    id: "profile",
    label: "Patient details",
    description: "Identity and contact information recorded at registration.",
    privileges: ["patient:read"],
  },
];
function date(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
function time(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function human(value: string) {
  return labels[value] ?? value.replaceAll("-", " ").replaceAll("_", " ");
}

function HistorySection({
  patientId,
  section,
  allowed,
  compact = false,
  onOpen,
  encounterId,
  personId,
  privileges = [],
  onNoteAction,
  onResolveProblem,
  onLabOrder,
  onImagingOrder,
}: {
  patientId: string;
  section: StaffChartSection;
  allowed: boolean;
  compact?: boolean;
  onOpen?: (
    section: StaffChartSection,
    encounterId?: string,
    encounterLabel?: string,
  ) => void;
  encounterId?: string;
  personId?: string;
  privileges?: string[];
  onNoteAction?: (id: string, amend: boolean) => void;
  onResolveProblem?: (id:string)=>void;
  onLabOrder?: (id:string)=>void;
  onImagingOrder?: (id:string)=>void;
}) {
  const [page, setPage] = useState<StaffChartHistoryPage | null>(null),
    [error, setError] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | undefined>(),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  const previous = useRef<(string | undefined)[]>([]);
  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setPage(null);
    setError(null);
    setLoading(true);
    api
      .chartHistory(patientId, section, cursor, controller.signal, encounterId)
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof ApiError
              ? err.message
              : "This part of the record could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [patientId, section, cursor, allowed, refresh, encounterId]);
  if (!allowed)
    return (
      <div className={compact ? "record-state record-state--compact" : "record-state"}>
        <span className="record-state__mark" aria-hidden="true">
          —
        </span>
        <h3>Access restricted</h3>
        <p>
          Your current facility permissions do not include this part of the
          record.
        </p>
      </div>
    );
  if (error)
    return (
      <div className="record-state">
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={() => setRefresh((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  if (loading)
    return (
      <div className="record-loading" role="status">
        <span />
        Loading {sections.find((s) => s.id === section)?.label.toLowerCase()}…
      </div>
    );
  if (!page?.items.length)
    return (
      <div className={compact ? "record-state record-state--compact" : "record-state"}>
        <span className="record-state__mark" aria-hidden="true">
          <RecordIcon kind={section} size={29} />
        </span>
        <h3>
          No{" "}
          {section === "profile"
            ? "registration details"
            : sections.find((s) => s.id === section)?.label.toLowerCase()}{" "}
          recorded
        </h3>
        <p>
          Records added during care will appear here. Missing information has
          not been clinically confirmed.
        </p>
      </div>
    );
  if (compact && section === "profile")
    return (
      <dl className="record-field-list record-contact-summary">
        {page.items[0]?.fields.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value || "Not recorded"}</dd>
          </div>
        ))}
      </dl>
    );
  return (
    <>
      <div
        className={
          section === "visits" ? "record-visit-list" : "record-history-list"
        }
      >
        {(compact ? page.items.slice(0, 3) : page.items).map((item) => (
          <article className="record-history-item" key={item.id}>
            <div className="record-history-item__date">
              <strong>{date(item.occurredAt)}</strong>
              <span>{time(item.occurredAt)}</span>
            </div>
            <div className="record-history-item__body">
              <div className="record-history-item__title">
                <h3>{labels[item.title] ?? item.title}</h3>
                <span className={`record-status record-status--${item.status}`}>
                  {human(item.status)}
                </span>
              </div>
              {compact ? (
                <p>
                  {item.fields
                    .filter((f) => f.value && (section !== "notes" || ["Assessment", "Plan"].includes(f.label)))
                    .slice(0, 2)
                    .map((f) => `${f.label}: ${f.value}`)
                    .join(" · ") || "Encounter recorded in this facility"}
                </p>
              ) : (
                <details open={section === "profile" || section === "vitals"}>
                  <summary>
                    {section === "visits"
                      ? "Visit details"
                      : section === "notes"
                        ? "Read note & care plan"
                        : "View recorded details"}
                  </summary>
                  {section === "investigations" ? <DiagnosticFindings item={item} /> : null}
                  <dl className="record-field-list">
                    {item.fields.map((field, index) => (
                      <div key={index}>
                        <dt>{field.label}</dt>
                        <dd>
                          {section === "notes" && item.note?.richText?.[({History:"history",Examination:"examination",Assessment:"assessment",Plan:"plan"} as const)[field.label as "History"]] ? <RichNoteView document={item.note.richText[({History:"history",Examination:"examination",Assessment:"assessment",Plan:"plan"} as const)[field.label as "History"]]!}/> : field.value?.trim() ? field.value : "Not recorded"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {section === "visits" && onOpen ? (
                    <div className="record-visit-links">
                      <button
                        onClick={() =>
                          onOpen(
                            "vitals",
                            item.id,
                            `${item.title} · ${date(item.occurredAt)}`,
                          )
                        }
                      >
                        Vitals for this visit
                      </button>
                      <button
                        onClick={() =>
                          onOpen(
                            "notes",
                            item.id,
                            `${item.title} · ${date(item.occurredAt)}`,
                          )
                        }
                      >
                        Notes for this visit
                      </button>
                      <button
                        onClick={() =>
                          onOpen(
                            "medications",
                            item.id,
                            `${item.title} · ${date(item.occurredAt)}`,
                          )
                        }
                      >
                        Treatment for this visit
                      </button>
                    </div>
                  ) : null}
                </details>
              )}
              {item.encounterId && section !== "visits" ? (
                <small className="record-encounter-ref">
                  {item.encounter
                    ? `${human(item.encounter.type)} visit · ${date(item.encounter.startedAt)}`
                    : "Linked to a patient encounter"}
                </small>
              ) : null}
              {section === "notes" &&
              item.note &&
              item.note.authorId === personId &&
              onNoteAction ? (
                <div className="record-note-actions">
                  {item.status === "draft" &&
                  privileges.includes("note:write") ? (
                    <button onClick={() => onNoteAction(item.id, false)}>
                      Edit draft
                    </button>
                  ) : null}
                  {item.status === "signed" &&
                  privileges.includes("note:amend") ? (
                    <button onClick={() => onNoteAction(item.id, true)}>
                      Add addendum
                    </button>
                  ) : null}
                  <small>
                    {item.note.kind} note · Revision {item.note.version}
                  </small>
                </div>
              ) : null}
              {section==='entries' && item.status==='active' && onResolveProblem && privileges.includes('entry:write') && privileges.includes('encounter:consult') && item.fields.some(f=>f.label==='Type'&&['problem','diagnosis'].includes(f.value??'')) && item.fields.some(f=>f.label==='Source'&&f.value==='local')?<div className="record-note-actions"><button onClick={()=>onResolveProblem(item.id)}>Mark resolved</button></div>:null}
              {section==='investigations'&&onLabOrder&&privileges.includes('lab:read')&&item.fields.some(f=>f.label==='Type'&&f.value==='Laboratory')?<div className="record-note-actions"><button onClick={()=>onLabOrder(item.id)}>Review laboratory order</button></div>:null}
              {section==='investigations'&&onImagingOrder&&privileges.includes('imaging:view')&&item.fields.some(f=>f.label==='Type'&&f.value==='Imaging')?<div className="record-note-actions"><button onClick={()=>onImagingOrder(item.id)}>Review imaging request</button></div>:null}
            </div>
          </article>
        ))}
      </div>
      {!compact && (page.nextCursor || previous.current.length) ? (
        <div className="record-pagination">
          <span>Up to 25 records per page · newest first</span>
          <div>
            <Button
              variant="secondary"
              disabled={!previous.current.length}
              onClick={() => setCursor(previous.current.pop())}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={!page.nextCursor}
              onClick={() => {
                previous.current.push(cursor);
                setCursor(page.nextCursor!);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function PatientRecord({
  chart,
  facilityName,
  personId,
  privileges,
}: {
  chart: StaffChartOverview;
  facilityName: string;
  personId: string;
  privileges: string[];
}) {
  const router=useRouter();
  const [problemEditor,setProblemEditor]=useState<{id?:string}|null>(null);
  const [allergyAction,setAllergyAction]=useState<AllergyAction|null>(null);
  const [labEditor,setLabEditor]=useState<{id?:string}|null>(null);
  const [imagingEditor,setImagingEditor]=useState<{id?:string}|null>(null);
  const [entriesRevision,setEntriesRevision]=useState(0);
  const [entryMessage,setEntryMessage]=useState<string|null>(null);
  const [selected, setSelected] = useState<StaffChartSection | "overview">(
    "overview",
  );
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [compactHeader, setCompactHeader] = useState(false);
  useEffect(() => {
    const topbar = document.querySelector(".topbar");
    let intersection: IntersectionObserver | undefined;
    const observe = () => {
      intersection?.disconnect();
      const offset = topbar?.getBoundingClientRect().height ?? 80;
      intersection = new IntersectionObserver(([entry]) => {
        setCompactHeader(!entry.isIntersecting && entry.boundingClientRect.top < offset);
      }, { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 });
      if (sentinel.current) intersection.observe(sentinel.current);
    };
    const resize = new ResizeObserver(observe);
    if (topbar) resize.observe(topbar);
    observe();
    return () => { intersection?.disconnect(); resize.disconnect(); };
  }, []);
  useEffect(() => {
    const topbar = document.querySelector(".topbar");
    const header = root.current?.querySelector(".record-context");
    const measure = () => {
      root.current?.style.setProperty(
        "--record-top-offset",
        `${topbar?.getBoundingClientRect().height ?? 80}px`,
      );
      root.current?.style.setProperty(
        "--record-header-height",
        `${header?.getBoundingClientRect().height ?? 140}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    if (topbar) observer.observe(topbar);
    if (header) observer.observe(header);
    measure();
    return () => observer.disconnect();
  }, []);
  const [selectedEncounter, setSelectedEncounter] = useState<
    string | undefined
  >();
  const [encounterLabel, setEncounterLabel] = useState<string>();
  const [noteEditor, setNoteEditor] = useState<{
    id?: string;
    amend?: boolean;
  } | null>(null);
  const [notesRevision, setNotesRevision] = useState(0);
  const patient = chart.patient;
  const can = (id: StaffChartSection | "overview") =>
    sections
      .find((s) => s.id === id)!
      .privileges.some((p) => privileges.includes(p));
  const section = sections.find((s) => s.id === selected)!;
  function open(
    id: StaffChartSection | "overview",
    encounterId?: string,
    label?: string,
  ) {
    setSelected(id);
    setSelectedEncounter(encounterId);
    setEncounterLabel(label);
  }
  return (
    <div ref={root} className={`patient-chart patient-record${compactHeader ? " patient-record--compact" : ""}`}>
      <div className="record-breadcrumb">
        <a href="/patients">Patients</a>
        <span>/</span>
        <span>Patient record</span>
        <span className="record-refreshed">
          Updated {time(chart.fetchedAt)}{" "}
          <button
            type="button"
            onClick={() => window.location.reload()}
            aria-label="Refresh patient record"
          >
            ↻
          </button>
        </span>
      </div>
      <div ref={sentinel} className="record-header-sentinel" aria-hidden="true" />
      <div className="record-context">
        <PatientRecordHeader key={patient.id} chart={chart} facilityName={facilityName} privileges={privileges} onOpen={open} onDocument={() => setNoteEditor({})} />
      </div>
      {patient.status === "retired-duplicate" ? (
        <Alert tone="warning">
          This is a merged patient record. Confirm the surviving identity before
          proceeding.
          {patient.mergedInto ? (
            <a href={`/patients/${patient.mergedInto}`}>
              {" "}
              Open surviving record
            </a>
          ) : null}
        </Alert>
      ) : null}
      <nav className="record-navigation" aria-label="Patient record sections">
        {sections.map((s) => (
          <button
            type="button"
            key={s.id}
            aria-label={s.label}
            className={selected === s.id ? "record-navigation__active" : ""}
            aria-current={selected === s.id ? "page" : undefined}
            onClick={() => open(s.id)}
          >
            {s.label}
            {!can(s.id) ? (
              <span className="record-lock" aria-label="Restricted">
                ▱
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      {entryMessage?<p role="status" className="note-save-message">{entryMessage}</p>:null}
      {selected === "overview" ? (
        <div className="record-overview">
          <div className="record-overview__main">
            <section className="record-current">
              {privileges.includes("encounter:read") ? (
                <PatientActiveVisit
                  key={notesRevision}
                  patientId={patient.id}
                  personId={personId}
                  privileges={privileges}
                  onDocument={() => setNoteEditor({})}
                  onOrderLab={()=>setLabEditor({})}
                  onReview={(id, encounterId) => open(id, encounterId, "Current encounter")}
                />
              ) : (
                <Alert tone="info">
                  Current visit information is restricted for your account.
                </Alert>
              )}
            </section>
            <LatestVitalSigns observations={chart.observations} onHistory={() => open("vitals")} />
            <ClinicalSummaryCards key={entriesRevision} patientId={patient.id} privileges={privileges} onOpen={open} onAddProblem={privileges.includes('entry:read')&&privileges.includes('entry:write')&&privileges.includes('encounter:consult')?()=>setProblemEditor({}):undefined} onOrderLab={privileges.includes('lab:read')&&privileges.includes('lab:order')&&privileges.includes('encounter:consult')?()=>setLabEditor({}):undefined} />
            <section className="record-panel">
              <div className="record-panel__heading"><div><span className="record-eyebrow">Assessment & treatment planning</span><h2><RecordIcon kind="notes" />Clinical documentation</h2></div><button onClick={() => open("notes")}>All notes →</button></div>
              <HistorySection key={notesRevision} patientId={patient.id} section="notes" allowed={can("notes")} compact />
            </section>
            <section className="record-panel">
              <div className="record-panel__heading">
                <div>
                  <span className="record-eyebrow">Longitudinal care</span>
                  <h2><RecordIcon kind="visits" />Clinical timeline</h2>
                </div>
                <button onClick={() => open("visits")}>All visits →</button>
              </div>
              <HistorySection
                patientId={patient.id}
                section="visits"
                allowed={can("visits")}
                compact
              />
            </section>
          </div>
          <aside className="record-overview__aside">
            <section className="record-panel">
              <div className="record-panel__heading">
                <h2><RecordIcon kind="patient" />Patient details</h2>
                <button onClick={() => open("profile")}>View →</button>
              </div>
              <dl className="record-field-list">
                <div>
                  <dt>Date of birth</dt>
                  <dd>{date(patient.dateOfBirth)}</dd>
                </div>
                <div>
                  <dt>Medical record number</dt>
                  <dd>{patient.mrn ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Facility</dt>
                  <dd>{facilityName}</dd>
                </div>
              </dl>
              <HistorySection
                patientId={patient.id}
                section="profile"
                allowed={can("profile")}
                compact
              />
            </section>
            <section className="record-panel">
              <div className="record-panel__heading"><h2><RecordIcon kind="documents" />Patient documents</h2><button onClick={() => open("documents")}>View all →</button></div>
              <HistorySection patientId={patient.id} section="documents" allowed={can("documents")} compact />
            </section>
            <section className="record-care-links">
              <h2>Quick access</h2>
              <button onClick={() => open("notes")}>
                <RecordIcon kind="notes" />Clinical notes <span>→</span>
              </button>
              <button onClick={() => open("medications")}>
                <RecordIcon kind="medications" />Treatment <span>→</span>
              </button>
              <button onClick={() => open("investigations")}>
                <RecordIcon kind="investigations" />Investigations <span>→</span>
              </button>
              <button onClick={() => open("documents")}>
                <RecordIcon kind="documents" />Documents <span>→</span>
              </button>
            </section>
          </aside>
        </div>
      ) : (
        <section className="record-panel record-section" key={selected}>
          <div className="record-section__heading">
            <span className="record-eyebrow">Longitudinal patient record</span>
            <h2>{section.label}</h2>
            <p>{section.description}</p>
            {selected === "notes" && privileges.includes("note:write") ? (
              <Button onClick={() => setNoteEditor({})}>New note</Button>
            ) : null}
            {selected==='entries'&&privileges.includes('entry:read')&&privileges.includes('entry:write')&&privileges.includes('encounter:consult')?<Button onClick={()=>setProblemEditor({})}>Add problem or diagnosis</Button>:null}
            {selected==='investigations'&&privileges.includes('lab:read')&&privileges.includes('lab:order')&&privileges.includes('encounter:consult')?<Button onClick={()=>setLabEditor({})}>Order laboratory test</Button>:null}
            {selected==='investigations'&&privileges.includes('imaging:view')&&privileges.includes('imaging:order')&&privileges.includes('encounter:consult')?<Button onClick={()=>setImagingEditor({})}>Request imaging</Button>:null}
          </div>
          {selected === "profile" ? (
            <dl className="record-profile-identity record-field-list">
              <div>
                <dt>Given name</dt>
                <dd>{patient.givenName}</dd>
              </div>
              <div>
                <dt>Family name</dt>
                <dd>{patient.familyName}</dd>
              </div>
              <div>
                <dt>Date of birth</dt>
                <dd>{date(patient.dateOfBirth)}</dd>
              </div>
              <div>
                <dt>MRN</dt>
                <dd>{patient.mrn ?? "Not recorded"}</dd>
              </div>
            </dl>
          ) : null}
          {selected==='entries'&&can('entries')?<AllergyRecordPanel key={'allergies'+entriesRevision} patientId={patient.id} privileges={privileges} onAction={setAllergyAction}/>:null}
          {selectedEncounter ? (
            <div className="record-visit-filter">
              Showing {encounterLabel ?? "selected visit"}
              <button onClick={() => setSelectedEncounter(undefined)}>
                Show all visits
              </button>
            </div>
          ) : null}
          <HistorySection
            key={selected + String(selectedEncounter) + notesRevision + entriesRevision}
            patientId={patient.id}
            section={selected}
            allowed={can(selected)}
            encounterId={selectedEncounter}
            onOpen={open}
            personId={personId}
            privileges={privileges}
            onNoteAction={(id, amend) => setNoteEditor({ id, amend })}
            onResolveProblem={id=>setProblemEditor({id})}
            onLabOrder={id=>setLabEditor({id})}
            onImagingOrder={id=>setImagingEditor({id})}
          />
        </section>
      )}
      {noteEditor ? (
        <ClinicalNoteEditor
          key={noteEditor.id ?? "new-note"}
          patientId={patient.id}
          patientName={`${patient.givenName} ${patient.familyName}`}
          mrn={patient.mrn}
          dateOfBirth={patient.dateOfBirth}
          noteId={noteEditor.id}
          amend={noteEditor.amend}
          privileges={privileges}
          onClose={() => setNoteEditor(null)}
          onSaved={() => setNotesRevision((n) => n + 1)}
        />
      ) : null}
      {problemEditor?<ProblemEntryDrawer key={problemEditor.id??'new-problem'} patientId={patient.id} patientName={`${patient.givenName} ${patient.familyName}`} mrn={patient.mrn} entryId={problemEditor.id} onClose={()=>setProblemEditor(null)} onSaved={()=>{setEntriesRevision(n=>n+1);setEntryMessage(problemEditor.id?'Entry marked resolved. The original record has been retained.':'Entry added to the patient’s problem list.');router.refresh();}}/>:null}
      {allergyAction?<AllergyDrawer key={allergyAction.mode+(allergyAction.id??'')} patientId={patient.id} patientName={`${patient.givenName} ${patient.familyName}`} mrn={patient.mrn} privileges={privileges} action={allergyAction} onClose={()=>setAllergyAction(null)} onSaved={()=>{setEntriesRevision(n=>n+1);setEntryMessage('Allergy record updated. Original entries and review evidence are retained.');router.refresh();}}/>:null}
      {imagingEditor?<ImagingOrderDrawer key={imagingEditor.id??'new-imaging-order'} patientId={patient.id} patientName={`${patient.givenName} ${patient.familyName}`} mrn={patient.mrn} orderId={imagingEditor.id} privileges={privileges} onClose={()=>setImagingEditor(null)} onSaved={r=>{setEntriesRevision(n=>n+1);setEntryMessage(r.status==='cancelled'?'Imaging request cancelled. The reason and original request are retained.':'Imaging requested. Radiology review is pending.');open('investigations');router.refresh();}}/>:null}
      {labEditor?<LabOrderDrawer key={labEditor.id??'new-lab-order'} patientId={patient.id} patientName={`${patient.givenName} ${patient.familyName}`} mrn={patient.mrn} orderId={labEditor.id} privileges={privileges} onClose={()=>setLabEditor(null)} onSaved={result=>{setEntriesRevision(n=>n+1);setEntryMessage(result.status==='cancelled'?'Laboratory order cancelled. The request and reason have been retained.':'Laboratory order placed. Specimen collection is pending.');open('investigations');router.refresh();}}/>:null}
    </div>
  );
}
