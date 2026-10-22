"use client";
import { useRef, useState } from "react";
import { Alert, Button } from "@pulse/ui";
import {
  ApiError,
  createStaffWebApi,
  type StaffPatientIdentity,
} from "@pulse/api-client";
import { SettingsDrawer } from "./settings-drawer.js";
const api = createStaffWebApi();
export function PatientCheckIn({
  patient,
  onCheckedIn,
}: {
  patient: StaffPatientIdentity;
  onCheckedIn?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [done, setDone] = useState(false);
  const key = useRef("");
  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      await api.checkInPatient(patient.id, key.current);
      setDone(true);
      onCheckedIn?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Check-in could not be saved. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="patient-open"
        type="button"
        onClick={() => {
          key.current = crypto.randomUUID();
          setError(null);
          setDone(false);
          setOpen(true);
        }}
      >
        Check in
      </button>
      {open ? (
        <SettingsDrawer
          id={`check-in-${patient.id}`}
          title="Check in patient"
          description="Confirm the patient’s identity before sending them for vitals."
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <div className="workflow-form">
            <div className="workflow-identity">
              <strong>
                {patient.givenName} {patient.familyName}
              </strong>
              <span>
                MRN {patient.mrn ?? "Not recorded"} · Born {patient.dateOfBirth}
              </span>
            </div>
            {error ? <Alert tone="error">{error}</Alert> : null}
            {done ? (
              <>
                <Alert tone="success">
                  Checked in. The active visit is in the staff worklists.
                </Alert>
                <a className="pulse-btn pulse-btn--primary" href="/worklists">
                  Open worklists
                </a>
              </>
            ) : (
              <>
                <p>
                  This starts an outpatient visit in the vitals queue. An
                  existing active visit is reused.
                </p>
                <Button disabled={busy} onClick={() => void checkIn()}>
                  {busy ? "Checking in..." : "Confirm check-in"}
                </Button>
              </>
            )}
          </div>
        </SettingsDrawer>
      ) : null}
    </>
  );
}
