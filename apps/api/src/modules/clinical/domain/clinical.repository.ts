/** Clinical domain (CLIN-001, DB-001 sections 16-20, EPIC-07/08). */

export type NoteStatus = 'draft' | 'signed';

export interface ClinicalNote {
  id: string;
  patientId: string;
  encounterId: string;
  authorId?: string;
  chiefComplaint: string;
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  status: NoteStatus;
}

export interface Observation {
  patientId: string;
  encounterId?: string;
  code: string;
  valueNum?: number;
  valueText?: string;
  unit?: string;
  /** Explicit observed time (external imports); defaults to now(). */
  takenAt?: string;
  /** Caller-supplied id (external idempotency claim); generated otherwise. */
  id?: string;
  /** Source authority: 'local' (default) or 'external' (FHIR-001 section 63). */
  origin?: 'local' | 'external';
}

export type EntryKind = 'problem' | 'allergy' | 'diagnosis';

export interface ClinicalEntry {
  patientId: string;
  encounterId?: string;
  kind: EntryKind;
  code?: string;
  display: string;
  status?: 'active' | 'resolved';
  /** Caller-supplied id (external idempotency claim); generated otherwise. */
  id?: string;
  /** Source authority: 'local' (default) or 'external' (FHIR-001 section 63). */
  origin?: 'local' | 'external';
}

export interface TimelineItem {
  at: string;
  kind: 'encounter' | 'note' | 'observation' | 'entry' | 'appointment';
  summary: string;
}

export const CLINICAL_REPOSITORY = 'CLINICAL_REPOSITORY';

export interface ClinicalRepository {
  recordObservation(input: Observation): Promise<{ id: string }>;
  createNote(input: {
    patientId: string;
    encounterId: string;
    authorId?: string;
    chiefComplaint: string;
    history: string;
    examination: string;
    assessment: string;
    plan: string;
  }): Promise<ClinicalNote>;
  signNote(id: string): Promise<ClinicalNote>;
  addAddendum(noteId: string, text: string): Promise<void>;
  recordEntry(input: ClinicalEntry): Promise<{ id: string }>;
  listEntries(patientId: string, kind?: EntryKind): Promise<{ kind: EntryKind; display: string; status: string }[]>;
  timeline(patientId: string, limit: number): Promise<TimelineItem[]>;
}
