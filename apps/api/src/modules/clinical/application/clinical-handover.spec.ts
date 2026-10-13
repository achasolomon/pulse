import { ClinicalService } from './clinical.service.js';
import type { ClinicalRepository } from '../domain/clinical.repository.js';
import type { EncounterRepository } from '../../encounter/domain/encounter.repository.js';
import type { PatientRepository } from '../../patient/domain/patient.repository.js';
import type { WorkflowRepository } from '../../workflow/domain/workflow.repository.js';
import type { DocumentRepository } from '../../documents/domain/document.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('ClinicalService handover/export (unit, fakes)', () => {
  function clinical(): ClinicalRepository {
    return {
      recordObservation: async () => ({ id: 'o1' }),
      createNote: async () => ({
        id: 'n1', patientId: 'p1', encounterId: 'e1', chiefComplaint: 'c',
        history: '', examination: '', assessment: '', plan: '', status: 'draft',
      }),
      signNote: async () => ({
        id: 'n1', patientId: 'p1', encounterId: 'e1', chiefComplaint: 'c',
        history: '', examination: '', assessment: '', plan: '', status: 'signed',
      }),
      addAddendum: async () => undefined,
      recordEntry: async () => ({ id: 'e1' }),
      listEntries: async (_patientId, kind) => [
        { kind: kind ?? 'problem', display: kind === 'allergy' ? 'Penicillin' : 'Hypertension', status: 'active' },
      ],
      timeline: async () => [{ at: '2026-01-01', kind: 'note', summary: 'Clinical note signed' }],
    };
  }

  const encounters = {
    open: async () => { throw new Error('not used'); },
    findById: async () => undefined,
    applyTransition: async () => { throw new Error('not used'); },
    listHistory: async () => [],
    setCoverage: async () => undefined,
    listActive: async () => [
      { id: 'e1', patientId: 'p1', facilityId: 'f1', type: 'inpatient' as const, status: 'admitted' as const },
    ],
  } as unknown as EncounterRepository;

  const patients = {
    findById: async () => ({
      id: 'p1', familyName: 'Doe', givenName: 'Jane', dateOfBirth: '1990-01-01',
      sex: 'F' as const, facilityId: 'f1', status: 'active' as const,
      identifiers: [{ system: 'urn:pulse:mrn:f1', value: 'M1' }],
    }),
  } as unknown as PatientRepository;

  const workflow = {
    openTasks: async () => [{ id: 't1', kind: 'review-result' }],
  } as unknown as WorkflowRepository;

  const documents = {
    listForPatient: async () => [{ id: 'd1', name: 'x.pdf', mime: 'application/pdf', storageKey: 'docs/x.pdf' }],
  } as unknown as DocumentRepository;

  function svc() {
    return new ClinicalService(
      clinical(),
      new OutboxService(undefined),
      encounters,
      patients,
      workflow,
      documents,
    );
  }

  it('composes handover with banner, problems, allergies, tasks', async () => {
    const h = await svc().handover('f1');
    expect(h.census).toBe(1);
    expect(h.items[0]?.problems).toEqual(['Hypertension']);
    expect(h.items[0]?.allergies).toEqual(['Penicillin']);
    expect(h.openTasks).toEqual([{ id: 't1', kind: 'review-result' }]);
  });

  it('exports a governed bundle', async () => {
    const b = await svc().exportBundle('p1');
    expect(b.patient?.id).toBe('p1');
    expect(b.timeline).toHaveLength(1);
    expect(b.documents).toHaveLength(1);
  });
});
