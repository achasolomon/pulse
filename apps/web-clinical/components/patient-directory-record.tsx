"use client";
import { useState } from "react";
import type { StaffPatientIdentity } from "@pulse/api-client";
import { SettingsDrawer } from "./settings-drawer.js";
export function PatientDirectoryRecord({
  patient,
  initialOpen = false,
  onClose,
}: {
  patient: StaffPatientIdentity;
  initialOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      {!initialOpen ? (
        <button
          type="button"
          className="patient-name patient-record-button"
          onClick={() => setOpen(true)}
        >
          {patient.familyName}, {patient.givenName}
        </button>
      ) : null}
      {open ? (
        <SettingsDrawer
          id={`identity-${patient.id}`}
          title="Patient record"
          description="Registration details for the selected facility."
          busy={false}
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        >
          <dl className="patient-identity-details">
            <div>
              <dt>Full name</dt>
              <dd>
                {patient.givenName} {patient.familyName}
              </dd>
            </div>
            <div>
              <dt>Medical record number</dt>
              <dd>{patient.mrn ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{patient.dateOfBirth}</dd>
            </div>
            <div>
              <dt>Sex</dt>
              <dd>
                {
                  { F: "Female", M: "Male", O: "Other", U: "Unknown" }[
                    patient.sex
                  ]
                }
              </dd>
            </div>
            <div>
              <dt>Record status</dt>
              <dd>
                {patient.status === "active" ? "Active" : "Merged record"}
              </dd>
            </div>
          </dl>
        </SettingsDrawer>
      ) : null}
    </>
  );
}
