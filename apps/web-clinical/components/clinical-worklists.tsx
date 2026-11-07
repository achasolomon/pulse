"use client";
import { useEffect, useState } from "react";
import {useRouter} from 'next/navigation';
import { Alert, Button } from "@pulse/ui";
import {
  ApiError,
  createStaffWebApi,
  type OutpatientVisit,
} from "@pulse/api-client";
import { VisitActions, stageLabels } from "./visit-actions.js";
import {RadiologyWorklist} from './radiology-worklist.js';
import {LaboratoryWorklist} from './laboratory-worklist.js';
import {worklistTabs} from "../lib/workspace-navigation.mjs";
const api = createStaffWebApi();
export function ClinicalWorklists({
  personId,
  initialQueue,
  initialOrderId,
  facilityId,
  privileges,
}: {
  personId: string;
  initialQueue?: string;
  initialOrderId?: string;
  facilityId: string;
  privileges: string[];
}) {
  const router=useRouter();
  const tabs = worklistTabs(privileges);
  const [queue, setQueue] = useState(tabs.find(tab=>tab.id===initialQueue)?.id ?? tabs[0]?.id ?? ""),
    [rows, setRows] = useState<OutpatientVisit[] | null>(null),
    [error, setError] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [updated, setUpdated] = useState<Date | null>(null);
  useEffect(() => {
    if (!queue||queue==='laboratory'||queue==='radiology') return;
    let controller = new AbortController();
    let running = false;
    setError(null);
    async function load() {
      if (running || document.hidden) return;
      running = true;
      try {
        const result = await api.visits(queue, controller.signal);
        if (!controller.signal.aborted) {
          setRows(result);
          setError(null);
          setUpdated(new Date());
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          if (err instanceof ApiError && err.status === 401)
            window.location.assign("/login");
          else
            setError(
              err instanceof ApiError
                ? err.message
                : "Could not load the worklist. Please retry.",
            );
        }
      } finally {
        running = false;
      }
    }
    void load();
    const interval = setInterval(() => void load(), 15_000);
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("focus", load);
    };
  }, [queue, facilityId, refresh]);
  if (!tabs.length)
    return (
      <Alert tone="warning">
        Your account does not have a worklist in this facility.
      </Alert>
    );
  return (
    <section className="clinical-worklists">
      <div className="workflow-toolbar">
        <div className="patient-worklist__filters" aria-label="Staff worklists">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              aria-pressed={queue === tab.id}
              onClick={() => { setRows(null); setQueue(tab.id); router.push(`/worklists?queue=${tab.id}`); }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div>
          {queue!=='laboratory'&&queue!=='radiology'?<a href="/patients">Find a patient</a>:null}
          <Button variant="secondary" onClick={() => setRefresh((n) => n + 1)}>
            Refresh
          </Button>
        </div>
      </div>
      {queue==='radiology'?<RadiologyWorklist initialOrderId={initialOrderId} onOrderClosed={()=>router.replace('/worklists?queue=radiology',{scroll:false})} facilityId={facilityId} refreshSignal={refresh} privileges={privileges}/>:queue==='laboratory'?<LaboratoryWorklist initialOrderId={initialOrderId} onOrderClosed={()=>router.replace('/worklists?queue=laboratory',{scroll:false})} personId={personId} facilityId={facilityId} privileges={privileges} refreshSignal={refresh}/>:<>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {rows === null && !error ? (
        <p role="status">Loading worklist...</p>
      ) : null}
      {rows && !rows.length && !error ? (
        <div className="patient-worklist__empty">
          <h2>
            {queue === "vitals"
              ? "No patients waiting for your vitals recording"
              : queue === "consultation"
                ? "No consultations assigned to you"
                : "No active outpatient visits"}
          </h2>
          <p>
            {queue === "consultation"
              ? "Nurse handoffs assigned to you appear here."
              : "Checked-in patients appear here automatically."}
          </p>
        </div>
      ) : null}
      {rows?.length ? (
        <div className="patient-table-wrap">
          <table className="patient-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Visit stage</th>
                <th>Checked in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((visit) => (
                <tr key={visit.id}>
                  <td>
                    <strong>
                      {visit.patient.givenName} {visit.patient.familyName}
                    </strong>
                    <span className="workflow-patient-meta">
                      MRN {visit.patient.mrn ?? "Not recorded"}
                      <br />
                      Born {visit.patient.dateOfBirth}
                    </span>
                  </td>
                  <td>
                    <span className={`visit-stage visit-stage--${visit.stage}`}>
                      {stageLabels[visit.stage]}
                    </span>
                  </td>
                  <td>
                    <time dateTime={visit.checkedInAt}>
                      {new Date(visit.checkedInAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </td>
                  <td>
                    <VisitActions
                      visit={visit}
                      personId={personId}
                      privileges={privileges}
                      onChanged={() => setRefresh((n) => n + 1)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {updated ? (
        <p className="workflow-hint">
          Updated {updated.toLocaleTimeString()} · Refreshes every 15 seconds ·
          Up to 100 active visits, oldest first
        </p>
      ) : null}
      </>}
    </section>
  );
}
