import { ReferralService } from './referral.service.js';
import { transitionReferral } from '../domain/referral.repository.js';
import type { ReferralRepository } from '../domain/referral.repository.js';
import type { ConsentRepository } from '../../consent/domain/consent.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('transitionReferral', () => {
  it('happy path to closed', () => {
    expect(transitionReferral('draft', 'submit')).toBe('submitted');
    expect(transitionReferral('submitted', 'acknowledge')).toBe('acknowledged');
    expect(transitionReferral('acknowledged', 'accept')).toBe('accepted');
    expect(transitionReferral('accepted', 'schedule')).toBe('scheduled');
    expect(transitionReferral('scheduled', 'dispatch')).toBe('in-transit');
    expect(transitionReferral('in-transit', 'arrive')).toBe('arrived');
    expect(transitionReferral('arrived', 'close')).toBe('closed');
  });

  it('info-request loop + decline + illegal moves', () => {
    expect(transitionReferral('acknowledged', 'request-info')).toBe('info-requested');
    expect(transitionReferral('info-requested', 'resubmit')).toBe('submitted');
    expect(transitionReferral('acknowledged', 'decline')).toBe('declined');
    expect(transitionReferral('declined', 'close')).toBe('closed');
    expect(() => transitionReferral('draft', 'accept')).toThrow('REFERRAL_TRANSITION');
    expect(() => transitionReferral('closed', 'submit')).toThrow('REFERRAL_TRANSITION');
  });
});

describe('ReferralService consent gate (unit, fakes)', () => {
  function fakes(consentOk: boolean) {
    const cases = new Map<string, { status: 'draft' | 'submitted' | 'acknowledged' | 'info-requested' | 'accepted' | 'declined' | 'scheduled' | 'in-transit' | 'arrived' | 'closed' | 'cancelled' | 'expired'; patientId: string }>();
    const repo: ReferralRepository = {
      create: async (input) => {
        const id = 'ffffffff-6666-4666-8666-666666666666';
        cases.set(id, { status: 'draft', patientId: input.patientId });
        return { id, status: 'draft' };
      },
      findCase: async (id) => {
        const c = cases.get(id);
        return c ? { id, patientId: c.patientId, sendingFacilityId: 's', status: c.status, packageVersion: 1 } : undefined;
      },
      setStatus: async (id, status) => {
        const c = cases.get(id);
        if (c) cases.set(id, { ...c, status });
      },
      savePackage: async () => ({ version: 2 }),
      addMessage: async () => ({ id: 'm1' }),
      messages: async () => [],
      inbox: async () => [],
      casesFor: async () => [],
    };
    const consent: ConsentRepository = {
      capture: async () => ({ id: 'c1', patientId: 'p', grantee: 'g', purpose: 'referral', scope: 's', status: 'granted' }),
      withdraw: async () => undefined,
      canDisclose: async () => consentOk,
      logDisclosure: async () => undefined,
    };
    return { repo, consent };
  }

  it('blocks submit without consent (422 CONSENT_REQUIRED)', async () => {
    const { repo, consent } = fakes(false);
    const svc = new ReferralService(repo, consent, new OutboxService(undefined));
    const c = await svc.create({
      patientId: 'p',
      sendingFacilityId: 's',
      type: 'routine',
      urgency: 'routine',
      clinicalQuestion: 'q',
    });
    const err = await svc.submit(c.id, {}).catch((e: unknown) => e as { status?: number; response?: { code?: string } });
    expect((err as { status?: number }).status).toBe(422);
  });

  it('sends with consent', async () => {
    const { repo, consent } = fakes(true);
    const svc = new ReferralService(repo, consent, new OutboxService(undefined));
    const c = await svc.create({
      patientId: 'p',
      sendingFacilityId: 's',
      type: 'routine',
      urgency: 'routine',
      clinicalQuestion: 'q',
    });
    const res = await svc.submit(c.id, {});
    expect(res.status).toBe('submitted');
  });
});
