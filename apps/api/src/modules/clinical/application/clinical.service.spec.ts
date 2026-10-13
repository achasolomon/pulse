import { ClinicalService } from './clinical.service.js';
import type { ClinicalRepository } from '../domain/clinical.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('ClinicalService sign guard (unit, fake repo)', () => {
  function fake(signed: boolean): ClinicalRepository {
    return {
      recordObservation: async () => ({ id: 'o1' }),
      createNote: async (input) => ({
        id: 'n1',
        patientId: input.patientId,
        encounterId: input.encounterId,
        chiefComplaint: input.chiefComplaint,
        history: '',
        examination: '',
        assessment: '',
        plan: '',
        status: 'draft',
      }),
      signNote: async () => {
        if (signed) throw new Error('NOTE_ALREADY_SIGNED');
        return {
          id: 'n1',
          patientId: 'p',
          encounterId: 'e',
          chiefComplaint: 'c',
          history: '',
          examination: '',
          assessment: '',
          plan: '',
          status: 'signed',
        };
      },
      addAddendum: async () => undefined,
      recordEntry: async () => ({ id: 'e1' }),
      listEntries: async () => [],
      timeline: async () => [],
    };
  }

  it('signs a draft', async () => {
    const svc = new ClinicalService(fake(false), new OutboxService(undefined));
    const note = await svc.signNote('n1', {});
    expect(note.status).toBe('signed');
  });

  it('maps double-sign to 409 with guidance', async () => {
    const svc = new ClinicalService(fake(true), new OutboxService(undefined));
    const err = await svc.signNote('n1', {}).catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(409);
  });
});
