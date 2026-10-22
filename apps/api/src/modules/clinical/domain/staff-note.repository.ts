import type {
  StaffClinicalNote,
  StaffNoteContext,
  StaffNoteSaveInput,
  StaffNoteDraftContent,
} from '@pulse/api-contracts';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
export const STAFF_NOTE_REPOSITORY = 'STAFF_NOTE_REPOSITORY';
export interface StaffNoteRepository {
  contexts(
    scope: PatientReadScope,
    patientId: string,
  ): Promise<StaffNoteContext[]>;
  get(scope: PatientReadScope, id: string): Promise<StaffClinicalNote>;
  save(
    scope: PatientReadScope,
    patientId: string,
    input: StaffNoteSaveInput,
  ): Promise<StaffClinicalNote>;
  update(
    scope: PatientReadScope,
    id: string,
    input: StaffNoteDraftContent & { commandKey: string; expectedVersion: number },
  ): Promise<StaffClinicalNote>;
  sign(
    scope: PatientReadScope,
    id: string,
    input: {
      commandKey: string;
      expectedVersion: number;
      attestation: boolean;
    },
  ): Promise<StaffClinicalNote>;
  amend(
    scope: PatientReadScope,
    id: string,
    input: { commandKey: string; text: string },
  ): Promise<StaffClinicalNote>;
}
