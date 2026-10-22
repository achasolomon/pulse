"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button } from "@pulse/ui";
import {
  ApiError,
  createStaffWebApi,
  type OutpatientVisit,
  type ConsultationStaff,
  type VitalMeasurement,
} from "@pulse/api-client";
import { SettingsDrawer } from "./settings-drawer.js";
const api = createStaffWebApi();
export const stageLabels: Record<OutpatientVisit["stage"], string> = {
  "waiting-vitals": "Waiting for vitals",
  "vitals-in-progress": "Vitals in progress",
  "vitals-recorded": "Vitals recorded",
  "waiting-consultation": "Waiting for consultation",
  "in-consultation": "In consultation",
  completed: "Completed",
  cancelled: "Cancelled",
};
const fields: {
  code: VitalMeasurement["code"];
  label: string;
  unit: string;
}[] = [
  { code: "bp-systolic", label: "Systolic BP", unit: "mmHg" },
  { code: "bp-diastolic", label: "Diastolic BP", unit: "mmHg" },
  { code: "heart-rate", label: "Heart rate", unit: "bpm" },
  { code: "respiratory-rate", label: "Respiratory rate", unit: "breaths/min" },
  { code: "temperature", label: "Temperature", unit: "°C" },
  { code: "spo2", label: "Oxygen saturation", unit: "%" },
  { code: "weight", label: "Weight", unit: "kg" },
  { code: "height", label: "Height", unit: "cm" },
];
function localTime() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function VisitActions({
  visit,
  personId,
  privileges,
  onChanged,
  showChartLink = true,
}: {
  visit: OutpatientVisit;
  personId: string;
  privileges: string[];
  onChanged: () => void;
  showChartLink?: boolean;
}) {
  const [drawer, setDrawer] = useState<"vitals" | "handoff" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [clinicians, setClinicians] = useState<ConsultationStaff[] | null>(
    null,
  );
  const command = useRef({ hash: "", key: "" });
  function key(input: unknown) {
    const hash = JSON.stringify(input);
    if (hash !== command.current.hash)
      command.current = { hash, key: crypto.randomUUID() };
    return command.current.key;
  }
  function open(which: "vitals" | "handoff") {
    setError(null);
    command.current = { hash: "", key: "" };
    setDrawer(which);
  }
  useEffect(() => {
    if (drawer !== "handoff") return;
    const controller = new AbortController();
    setClinicians(null);
    api
      .consultationStaff(controller.signal)
      .then(setClinicians)
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not load consultation staff.",
          );
      });
    return () => controller.abort();
  }, [drawer]);
  async function run(work: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
      after?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "The action could not be saved. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  function saveVitals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const measurements = fields
      .filter((field) => String(data.get(field.code) ?? "").trim() !== "")
      .map((field) => ({
        code: field.code,
        value: Number(data.get(field.code)),
      }));
    if (!measurements.length) {
      setError("Enter at least one measured value.");
      return;
    }
    if (
      measurements.some((m) => m.code === "bp-systolic") !==
      measurements.some((m) => m.code === "bp-diastolic")
    ) {
      setError("Enter both systolic and diastolic blood pressure.");
      return;
    }
    const takenAt = new Date(String(data.get("takenAt"))).toISOString();
    void run(
      () =>
        api.recordVitals(
          visit.id,
          measurements,
          takenAt,
          key({ action: "vitals", measurements, takenAt }),
        ),
      () => setDrawer(null),
    );
  }
  const nurse = privileges.includes("observation:write"),
    owned = visit.nursePersonId === personId;
  return (
    <div className="visit-actions">
      {error && !drawer ? <Alert tone="error">{error}</Alert> : null}
      {nurse && visit.stage === "waiting-vitals" ? (
        <Button
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                api.claimVisit(
                  visit.id,
                  key({ action: "claim", id: visit.id }),
                ),
              () => open("vitals"),
            )
          }
        >
          {busy ? "Starting..." : "Start vitals"}
        </Button>
      ) : null}
      {nurse &&
      owned &&
      ["vitals-in-progress", "vitals-recorded"].includes(visit.stage) ? (
        <Button
          variant={visit.stage === "vitals-recorded" ? "secondary" : "primary"}
          onClick={() => open("vitals")}
        >
          Record vitals
        </Button>
      ) : null}
      {nurse && owned && visit.stage === "vitals-recorded" ? (
        <Button onClick={() => open("handoff")}>Send to consultation</Button>
      ) : null}
      {privileges.includes("encounter:consult") &&
      visit.clinicianPersonId === personId &&
      visit.stage === "waiting-consultation" ? (
        <Button
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                api.startConsultation(
                  visit.id,
                  key({ action: "start", id: visit.id }),
                ),
              () => window.location.assign(`/patients/${visit.patient.id}`),
            )
          }
        >
          {busy ? "Starting..." : "Start consultation"}
        </Button>
      ) : null}
      {showChartLink && (owned || visit.clinicianPersonId === personId) ? (
        <a className="patient-open" href={`/patients/${visit.patient.id}`}>
          Open chart
        </a>
      ) : null}
      {drawer ? (
        <SettingsDrawer
          id={`visit-${visit.id}`}
          title={drawer === "vitals" ? "Record vitals" : "Send to consultation"}
          description="Confirm the patient and record the next step in this visit."
          busy={busy}
          onClose={() => setDrawer(null)}
          footerActions={
            <Button
              type="submit"
              form={`visit-form-${visit.id}`}
              disabled={busy || (drawer === "handoff" && !clinicians?.length)}
            >
              {busy
                ? drawer === "vitals"
                  ? "Saving..."
                  : "Sending..."
                : drawer === "vitals"
                  ? "Save vitals"
                  : "Confirm handoff"}
            </Button>
          }
        >
          <div className="workflow-identity">
            <strong>
              {visit.patient.givenName} {visit.patient.familyName}
            </strong>
            <span>
              MRN {visit.patient.mrn ?? "Not recorded"} · Born{" "}
              {visit.patient.dateOfBirth}
            </span>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {drawer === "vitals" ? (
            <form
              id={`visit-form-${visit.id}`}
              className="workflow-form"
              onSubmit={saveVitals}
            >
              <label>
                Measured at
                <input
                  name="takenAt"
                  type="datetime-local"
                  required
                  defaultValue={localTime()}
                />
              </label>
              <div className="workflow-fields">
                {fields.map((field) => (
                  <label key={field.code}>
                    {field.label} <small>{field.unit}</small>
                    <input
                      name={field.code}
                      type="number"
                      step="any"
                      min="0"
                      max={field.code === "spo2" ? "100" : "10000"}
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>
              <p className="workflow-hint">
                Enter measured values only. Empty fields remain unrecorded.
                Saving adds observations to the patient chart.
              </p>
            </form>
          ) : (
            <form
              id={`visit-form-${visit.id}`}
              className="workflow-form"
              onSubmit={(event) => {
                event.preventDefault();
                const clinicianId = String(
                  new FormData(event.currentTarget).get("clinicianId"),
                );
                void run(
                  () =>
                    api.handoffVisit(
                      visit.id,
                      clinicianId,
                      key({ action: "handoff", clinicianId }),
                    ),
                  () => setDrawer(null),
                );
              }}
            >
              <label>
                Consultation staff
                <select
                  name="clinicianId"
                  required
                  defaultValue=""
                  disabled={!clinicians?.length || busy}
                >
                  <option value="" disabled>
                    {clinicians === null
                      ? "Loading staff..."
                      : "Select consultation staff"}
                  </option>
                  {clinicians?.map((c) => (
                    <option key={c.personId} value={c.personId}>
                      {c.loginId}
                    </option>
                  ))}
                </select>
              </label>
              {clinicians && !clinicians.length ? (
                <Alert tone="warning">
                  No consultation staff are available in this facility. The
                  visit stays in your queue.
                </Alert>
              ) : (
                <p>
                  The visit will appear in the selected clinician’s consultation
                  queue.
                </p>
              )}
            </form>
          )}
        </SettingsDrawer>
      ) : null}
    </div>
  );
}
