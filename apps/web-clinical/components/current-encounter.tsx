"use client";
import { useEffect, useState } from "react";
import { Alert, Button } from "@pulse/ui";
import { ApiError, createStaffWebApi, type OutpatientVisit, type StaffChartHistoryPage } from "@pulse/api-client";
import { VisitActions, stageLabels } from "./visit-actions.js";
import { RecordIcon } from "./record-icon.js";
const api = createStaffWebApi();
const nextSteps: Record<OutpatientVisit["stage"], string> = {
  "waiting-vitals": "Nursing assessment and observations",
  "vitals-in-progress": "Record observations, then prepare handover",
  "vitals-recorded": "Assign a clinician and send to consultation",
  "waiting-consultation": "Assigned clinician to begin consultation",
  "in-consultation": "Document assessment and treatment plan",
  completed: "Review completed encounter",
  cancelled: "Review cancelled encounter",
};
export function PatientActiveVisit({ patientId, personId, privileges, onDocument, onReview,onOrderLab }: {
  patientId: string; personId: string; privileges: string[];
  onDocument?: () => void;
  onOrderLab?:()=>void;
  onReview?: (section: "notes" | "investigations" | "medications", encounterId: string) => void;
}) {
  const [visit, setVisit] = useState<OutpatientVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [notes, setNotes] = useState<StaffChartHistoryPage | null>(null);
  const [notesError, setNotesError] = useState(false);
  const canReadNotes = privileges.includes("note:read");
  useEffect(() => {
    const controller = new AbortController();
    setVisit(null); setLoading(true); setError(null);
    api.currentVisit(patientId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setVisit(result); })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : "Could not load the active visit."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [patientId, revision]);
  useEffect(() => {
    setNotes(null); setNotesError(false);
    if (!visit || !canReadNotes) return;
    const controller = new AbortController();
    api.chartHistory(patientId, "notes", undefined, controller.signal, visit.encounterId)
      .then((result) => { if (!controller.signal.aborted) setNotes(result); })
      .catch(() => { if (!controller.signal.aborted) setNotesError(true); });
    return () => controller.abort();
  }, [patientId, visit, canReadNotes]);
  const complaint = notes?.items.find((item) => item.note?.kind === "consultation" && item.title !== "Clinical note") ?? notes?.items.find((item) => item.title !== "Clinical note");
  const progress = visit ? ({ "waiting-vitals": 1, "vitals-in-progress": 1, "vitals-recorded": -1, "waiting-consultation": 2, "in-consultation": 2, completed: 3, cancelled: -1 }[visit.stage]) : -1;
  const canDocument = visit && !["completed", "cancelled"].includes(visit.stage) && privileges.includes("note:write") && ((visit.nursePersonId === personId && privileges.includes("note:nursing")) || (visit.clinicianPersonId === personId && visit.stage === "in-consultation"));
  const review = (section: "notes" | "investigations" | "medications") => { if (visit) onReview?.(section, visit.encounterId); };
  return <section className="pulse-card encounter-workspace encounter-card" aria-labelledby="current-encounter-title">
    <div className="encounter-card__heading">
      <span className="encounter-card__icon"><RecordIcon kind="notes" size={22} /></span>
      <div className="encounter-card__title-group"><div className="encounter-card__title-row"><h2 id="current-encounter-title">Current visit</h2>{visit ? <><span className="encounter-card__type">OPD</span><span className="encounter-card__stage"><span aria-hidden="true" />{stageLabels[visit.stage]}</span></> : null}</div>
        {visit ? <div className="encounter-card__metadata"><span>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(visit.checkedInAt))}</span><span>{new Intl.DateTimeFormat("en-GB", {hour: "2-digit", minute: "2-digit"}).format(new Date(visit.checkedInAt))}</span><span>Outpatient visit</span></div> : null}
      </div>
    </div>
    {error ? <div className="encounter-card__state"><Alert tone="error">{error}</Alert><Button variant="secondary" onClick={() => setRevision((n) => n + 1)}>Retry</Button></div> : loading ? <div className="encounter-card__loading" role="status">Loading current encounter…</div> : !visit ? <div className="encounter-card__empty"><div><h3>No active outpatient encounter</h3><p>Visit details and care actions appear here after check-in.</p></div><a href="/worklists">View worklists <span aria-hidden="true">→</span></a></div> : <>
      <div className="encounter-card__body">
        <div className="encounter-card__complaint"><div className="encounter-card__section-title"><h3>Presenting complaint</h3>{canDocument && !complaint && onDocument ? <button onClick={onDocument}>Add <span aria-hidden="true">＋</span></button> : null}</div><p>{!canReadNotes ? "Clinical documentation is restricted" : notesError ? "Documentation could not be loaded" : !notes ? "Loading documentation…" : complaint?.title ?? "Not yet documented"}</p>{complaint ? <small>{complaint.status === "draft" ? "Your draft · not signed" : "From signed clinical note"}</small> : null}
          <div className="encounter-card__team"><RecordIcon kind="patient" size={15} /><span>{visit.nursePersonId === personId ? "You · nurse" : visit.nursePersonId ? "Nurse assigned" : "Nurse unassigned"}</span><span>{visit.clinicianPersonId === personId ? "You · clinician" : visit.clinicianPersonId ? "Clinician assigned" : "Clinician unassigned"}</span></div>
        </div>
        <div className="encounter-card__progress"><h3>Encounter progress</h3><ol aria-label="Encounter progress">{["Check-in", "Vitals", "Consultation", "Complete"].map((label, index) => { const done = visit.stage === "completed" || (index === 0 && visit.stage !== "cancelled") || (index === 1 && ["vitals-recorded", "waiting-consultation", "in-consultation"].includes(visit.stage)); const current = index === progress && !done; return <li key={label} className={done ? "is-done" : current ? "is-current" : ""} aria-current={current ? "step" : undefined}><span aria-hidden="true">{done ? "✓" : ""}</span><small>{label}</small></li>; })}</ol><p className="encounter-card__next"><strong>Next</strong>{nextSteps[visit.stage]}</p></div>
      </div>
      <div className="encounter-card__actions consultation-actions">
        <div className="consultation-actions__primary"><span>{visit.stage==='waiting-consultation'?'Next: start consultation':canDocument?'Next: record care':'Care actions'}</span>
        {canDocument && onDocument ? <Button variant={visit.nursePersonId === personId && visit.stage !== "in-consultation" ? "secondary" : "primary"} onClick={onDocument}><RecordIcon kind="notes" size={16} />{privileges.includes("note:nursing") && visit.nursePersonId === personId ? "Write nursing note" : "Write clinical note"}</Button> : null}
        <VisitActions visit={visit} personId={personId} privileges={privileges} showChartLink={false} onChanged={() => window.location.reload()} />
        </div><div className="consultation-actions__secondary"><span>Tests & results</span>
        {onOrderLab&&visit.stage==='in-consultation'&&visit.clinicianPersonId===personId&&['lab:read','lab:order','encounter:consult'].every(p=>privileges.includes(p))?<Button variant="secondary" onClick={onOrderLab}><RecordIcon kind="investigations" size={16}/>Request a lab test</Button>:null}
        {onReview && (privileges.includes("lab:read") || privileges.includes("imaging:view")) ? <Button variant="secondary" onClick={() => review("investigations")}><RecordIcon kind="investigations" size={16} />View test results</Button> : null}
        </div>{onReview&&(canReadNotes||privileges.includes('medication:read'))?<details className="consultation-actions__more"><summary>Notes & treatment history</summary>
        {canReadNotes ? <Button variant="secondary" onClick={() => review("notes")}><RecordIcon kind="notes" size={16} />Visit notes</Button> : null}
        {privileges.includes("medication:read") ? <Button variant="secondary" onClick={() => review("medications")}><RecordIcon kind="medications" size={16} />Treatment record</Button> : null}
        </details>:null}
      </div>
    </>}
  </section>;
}
