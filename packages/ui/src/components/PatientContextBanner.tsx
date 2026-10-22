import { StatusBadge } from './StatusBadge.js';

export interface PatientContextPatient {
  displayName: string;
  mrn: string;
  age?: number;
  dateOfBirth?: string;
  sex?: string;
  encounter?: string;
  allergies?: string;
  isolation?: boolean;
}

export interface PatientContextBannerProps {
  patient?: PatientContextPatient;
}

/**
 * Persistent patient identity strip on patient-scoped screens (UX-001 §6,
 * FE-001 §9). Identity-critical values are never truncated ambiguously; allergy
 * and isolation flags carry text, not colour alone. Explicitly empty when no
 * patient is selected — never silently stale (wrong-patient prevention §7).
 */
export function PatientContextBanner({ patient }: PatientContextBannerProps) {
  if (patient === undefined) {
    return (
      <div className="pulse-patient-banner pulse-patient-banner--empty" role="status">
        No patient selected — search for a patient to pin the context banner.
      </div>
    );
  }
  return (
    <div className="pulse-patient-banner" role="region" aria-label="Active patient">
      <div>
        <div className="pulse-patient-banner__name">{patient.displayName}</div>
        <div className="pulse-patient-banner__meta">
          <span className="pulse-patient-banner__id">MRN {patient.mrn}</span>
          {patient.dateOfBirth !== undefined ? <span>Born {patient.dateOfBirth}</span> : null}
          {patient.age !== undefined ? <span>{patient.age} yrs</span> : null}
          {patient.sex !== undefined ? <span>{patient.sex}</span> : null}
          {patient.encounter !== undefined ? <span>{patient.encounter}</span> : null}
        </div>
      </div>
      <div className="pulse-patient-banner__meta" style={{ marginLeft: 'auto' }}>
        {patient.allergies !== undefined ? (
          <StatusBadge tone="warning" label={`Allergies: ${patient.allergies}`} />
        ) : (
          <StatusBadge tone="warning" label="Allergies: Not recorded" />
        )}
        {patient.isolation === true ? (
          <StatusBadge tone="info" label="Isolation precautions" />
        ) : null}
      </div>
    </div>
  );
}
