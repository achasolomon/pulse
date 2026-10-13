import { AnatomyService } from './anatomy.service.js';
import {
  assertFindingAction,
  type AnatomyFinding,
  type AnatomyRepository,
} from '../domain/anatomy.repository.js';
import type { OutboxService } from '../../../platform/outbox/outbox.service.js';

const M = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaabbbb';
const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbccc';
const P = '11111111-1111-4111-8111-111111111111';
const P_OTHER = '11111111-1111-4111-8111-111111112222';
const E = '22222222-2222-4222-8222-222222222222';
const E_OTHER = '22222222-2222-4222-8222-222222223333';
const F = '99999999-9999-4999-8999-999999999999';
const U = '33333333-3333-4333-8333-333333333333';
const X = '44444444-4444-4444-8444-444444444444';

describe('assertFindingAction (pure guard)', () => {
  const draft = { status: 'draft' as const, laterality: 'left' as const };
  const draftNoLat = { status: 'draft' as const, laterality: null };
  const signed = { status: 'signed' as const, laterality: 'left' as const };
  const amended = { status: 'amended' as const, laterality: 'left' as const };
  const errored = { status: 'entered_in_error' as const, laterality: null };

  it('draft allows update/sign/enterError, not amend', () => {
    expect(() => assertFindingAction(draft, 'update')).not.toThrow();
    expect(() => assertFindingAction(draft, 'sign')).not.toThrow();
    expect(() => assertFindingAction(draft, 'enterError')).not.toThrow();
    expect(() => assertFindingAction(draft, 'amend')).toThrow('ANAT_TRANSITION:draft->amend');
  });

  it('signing requires semantic laterality (anatomy safety rule)', () => {
    expect(() => assertFindingAction(draftNoLat, 'sign')).toThrow('ANAT_LATERALITY_REQUIRED');
  });

  it('signed allows amend/enterError, not update/sign', () => {
    expect(() => assertFindingAction(signed, 'amend')).not.toThrow();
    expect(() => assertFindingAction(signed, 'enterError')).not.toThrow();
    expect(() => assertFindingAction(signed, 'update')).toThrow('ANAT_TRANSITION');
    expect(() => assertFindingAction(signed, 'sign')).toThrow('ANAT_TRANSITION');
  });

  it('amended and entered-in-error are terminal', () => {
    for (const action of ['update', 'sign', 'amend', 'enterError'] as const) {
      expect(() => assertFindingAction(amended, action)).toThrow('ANAT_TRANSITION');
      expect(() => assertFindingAction(errored, action)).toThrow('ANAT_TRANSITION');
    }
  });
});

describe('AnatomyService (unit, fake repo)', () => {
  function fake(): AnatomyRepository {
    let seq = 0;
    const next = () => `${String(++seq).padStart(8, '0')}-0000-4000-8000-000000000000`;
    const models = new Map<string, Awaited<ReturnType<AnatomyRepository['createModel']>>>();
    const structures = new Map<string, Awaited<ReturnType<AnatomyRepository['createStructure']>>>();
    const findings = new Map<string, AnatomyFinding>();
    const links: Awaited<ReturnType<AnatomyRepository['listLinks']>> = [];
    const finding = (id: string, patch: Partial<AnatomyFinding> = {}): AnatomyFinding => ({
      id,
      patientId: P,
      encounterId: E,
      facilityId: F,
      anatomyModelId: M,
      anatomyStructureId: S1,
      laterality: null,
      findingType: 'pain',
      findingText: '',
      severity: null,
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
      recordedAt: new Date('2026-01-01T00:00:00Z'),
      authorId: U,
      status: 'draft',
      version: 1,
      geometry: [],
      clientRef: null,
      amendsId: null,
      amendmentReason: null,
      errorReason: null,
      signedBy: null,
      signedAt: null,
      ...patch,
    });
    const repo: AnatomyRepository = {
      createModel: async (input) => {
        const m = { id: input.modelName === 'adult' ? M : M2, ...input };
        models.set(m.id, m);
        return m;
      },
      findModel: async (id) => models.get(id),
      findModelByNameVersion: async (name, version) =>
        [...models.values()].find((m) => m.modelName === name && m.version === version),
      listModels: async () => [...models.values()],
      createStructure: async (input) => {
        const id =
          input.vendorStructureKey === 'femur' ? S1 : input.vendorStructureKey === 'other' ? S2 : next();
        const s = { id, active: true, ...input };
        structures.set(s.id, s);
        return s;
      },
      findStructure: async (id) => structures.get(id),
      listStructures: async (modelId) =>
        [...structures.values()].filter((s) => s.modelId === modelId),
      createMapping: async (input) => ({ id: next(), ...input }),
      listMappings: async () => [],
      createFinding: async (input) => {
        const f = finding(next(), { ...input });
        findings.set(f.id, f);
        return f;
      },
      findFinding: async (id) => findings.get(id),
      findFindingByClientRef: async (_facilityId, clientRef) =>
        [...findings.values()].find((f) => f.clientRef === clientRef),
      updateDraft: async (id, expectedVersion, patch) => {
        const f = findings.get(id);
        if (!f || f.status !== 'draft' || f.version !== expectedVersion) return undefined;
        const updated: AnatomyFinding = {
          ...f,
          ...(patch.laterality !== undefined ? { laterality: patch.laterality } : {}),
          ...(patch.findingType !== undefined ? { findingType: patch.findingType } : {}),
          ...(patch.findingText !== undefined ? { findingText: patch.findingText } : {}),
          ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
          ...(patch.effectiveAt !== undefined ? { effectiveAt: patch.effectiveAt } : {}),
          ...(patch.geometry !== undefined ? { geometry: patch.geometry } : {}),
          version: expectedVersion + 1,
        };
        findings.set(id, updated);
        return updated;
      },
      setFindingStatus: async (id, status, extra) => {
        const f = findings.get(id);
        if (!f) throw new Error('missing');
        const updated: AnatomyFinding = {
          ...f,
          status,
          ...(extra?.signedBy ? { signedBy: extra.signedBy, signedAt: new Date() } : {}),
          ...(extra?.errorReason ? { errorReason: extra.errorReason } : {}),
        };
        findings.set(id, updated);
        return updated;
      },
      amendFinding: async (prior, input) => {
        findings.set(prior.id, { ...prior, status: 'amended' });
        const { id: _priorId, ...rest } = prior;
        const created = finding(next(), {
          ...rest,
          laterality: input.laterality,
          findingType: input.findingType,
          findingText: input.findingText,
          severity: input.severity,
          effectiveAt: input.effectiveAt,
          authorId: input.authorId,
          geometry: input.geometry,
          status: 'draft',
          version: 1,
          signedBy: null,
          signedAt: null,
          amendsId: prior.id,
          amendmentReason: input.amendmentReason,
          errorReason: null,
        });
        findings.set(created.id, created);
        return created;
      },
      listFindings: async (filter) =>
        [...findings.values()].filter(
          (f) =>
            f.patientId === filter.patientId &&
            (!filter.facilityId || f.facilityId === filter.facilityId) &&
            (!filter.structureId || f.anatomyStructureId === filter.structureId),
        ),
      encounterPatientId: async (encounterId) => (encounterId === E ? P : P_OTHER),
      addLink: async (findingId, targetType, targetId) => {
        const link = { id: next(), findingId, targetType, targetId };
        links.push(link);
        return link;
      },
      listLinks: async (findingId) => links.filter((l) => l.findingId === findingId),
      targetPatientId: async (_targetType, targetId) => {
        if (targetId === X) return undefined;
        if (targetId === E_OTHER) return P_OTHER;
        return P;
      },
    };
    return repo;
  }

  function svc(repo: AnatomyRepository = fake()) {
    const published: { type?: string }[] = [];
    const outbox = {
      publish: async (e: { type: string }) => {
        published.push(e);
      },
    } as unknown as OutboxService;
    return { service: new AnatomyService(repo, outbox), published };
  }

  async function activeWorld(repo = fake()) {
    const { service, published } = svc(repo);
    await service.createModel({ vendor: 'v', modelName: 'adult', version: '1', status: 'active' });
    await service.createStructure({
      modelId: M,
      vendorStructureKey: 'femur',
      level: 'structure',
      name: 'Femur',
      code: 'FEM',
    });
    return { service, published, repo };
  }

  const baseFinding = {
    patientId: P,
    encounterId: E,
    facilityId: F,
    anatomyModelId: M,
    anatomyStructureId: S1,
    findingType: 'pain',
    authorId: U,
  };

  const status = (e: unknown) => (e as { status?: number }).status;

  const codeOf = (e: unknown) => {
    const ex = e as { getResponse?: () => unknown };
    const r = ex.getResponse?.();
    return typeof r === 'object' && r !== null
      ? (r as { code?: string }).code
      : undefined;
  };

  it('publishes model_created and rejects duplicate name+version (409)', async () => {
    const { service, published } = svc();
    await service.createModel({ vendor: 'v', modelName: 'adult', version: '1' });
    expect(published.map((e) => e.type)).toContain('anatomy.model_created');
    const dup = await service
      .createModel({ vendor: 'v', modelName: 'adult', version: '1' })
      .catch((e: unknown) => e);
    expect(status(dup)).toBe(409);
  });

  it('rejects unknown parent (404) and cross-model parent (400)', async () => {
    const { service } = svc();
    await service.createModel({ vendor: 'v', modelName: 'adult', version: '1' });
    await service.createModel({ vendor: 'v', modelName: 'paed', version: '1' });
    await service.createStructure({
      modelId: M2,
      vendorStructureKey: 'other',
      level: 'region',
      name: 'Other',
      code: 'OTH',
    });

    const missing = await service
      .createStructure({
        modelId: M,
        vendorStructureKey: 'x',
        parentStructureId: X,
        level: 'structure',
        name: 'X',
        code: 'X',
      })
      .catch((e: unknown) => e);
    expect(status(missing)).toBe(404);

    const mismatch = await service
      .createStructure({
        modelId: M,
        vendorStructureKey: 'x',
        parentStructureId: S2,
        level: 'structure',
        name: 'X',
        code: 'X',
      })
      .catch((e: unknown) => e);
    expect(status(mismatch)).toBe(400);
  });

  it('blocks findings on non-active model (422)', async () => {
    const { service } = svc();
    await service.createModel({ vendor: 'v', modelName: 'adult', version: '1' });
    await service.createStructure({
      modelId: M,
      vendorStructureKey: 'femur',
      level: 'structure',
      name: 'Femur',
      code: 'FEM',
    });
    const err = await service.createFinding(baseFinding).catch((e: unknown) => e);
    expect(status(err)).toBe(422);
    expect(codeOf(err)).toBe('MODEL_NOT_ACTIVE');
  });

  it('rejects encounter belonging to another patient (400)', async () => {
    const { service } = await activeWorld();
    const err = await service
      .createFinding({ ...baseFinding, encounterId: E_OTHER })
      .catch((e: unknown) => e);
    expect(status(err)).toBe(400);
    expect(codeOf(err)).toBe('ENCOUNTER_PATIENT_MISMATCH');
  });

  it('draft -> sign requires laterality (400), then signs with event', async () => {
    const { service, published } = await activeWorld();
    const draft = await service.createFinding(baseFinding);
    expect(published.map((e) => e.type)).toContain('anatomy.finding_drafted');

    const noLat = await service.sign(draft.id, { signedBy: U }).catch((e: unknown) => e);
    expect(codeOf(noLat)).toBe('ANAT_LATERALITY_REQUIRED');

    await service.updateDraft(draft.id, {
      expectedVersion: draft.version,
      laterality: 'left',
    });
    const signed = await service.sign(draft.id, { signedBy: U });
    expect(signed.status).toBe('signed');
    expect(published.map((e) => e.type)).toContain('anatomy.finding_signed');

    const twice = await service.sign(draft.id, { signedBy: U }).catch((e: unknown) => e);
    expect(status(twice)).toBe(422);
  });

  it('updateDraft enforces optimistic version (409)', async () => {
    const { service } = await activeWorld();
    const draft = await service.createFinding(baseFinding);
    await service.updateDraft(draft.id, { expectedVersion: 1, findingText: 'one' });
    const stale = await service
      .updateDraft(draft.id, { expectedVersion: 1, findingText: 'two' })
      .catch((e: unknown) => e);
    expect(status(stale)).toBe(409);
  });

  it('sign -> amend creates linked draft and marks prior amended', async () => {
    const { service, published } = await activeWorld();
    const draft = await service.createFinding({ ...baseFinding, laterality: 'left' });
    await service.sign(draft.id, { signedBy: U });
    const amended = await service.amend(draft.id, {
      amendmentReason: 'measurement corrected',
      authorId: U,
      findingText: 'updated',
    });
    expect(amended.amendsId).toBe(draft.id);
    expect(amended.status).toBe('draft');
    expect((await service.getFinding(draft.id)).status).toBe('amended');
    expect(published.map((e) => e.type)).toContain('anatomy.finding_amended');

    const again = await service
      .amend(draft.id, { amendmentReason: 'again', authorId: U })
      .catch((e: unknown) => e);
    expect(status(again)).toBe(422);
  });

  it('enter-error is terminal, records reason, publishes event', async () => {
    const { service, published } = await activeWorld();
    const draft = await service.createFinding(baseFinding);
    const done = await service.enterError(draft.id, { reason: 'entered on wrong patient' });
    expect(done.status).toBe('entered_in_error');
    expect(done.errorReason).toContain('wrong patient');
    expect(published.map((e) => e.type)).toContain('anatomy.finding_entered_in_error');
    const after = await service.sign(draft.id, { signedBy: U }).catch((e: unknown) => e);
    expect(status(after)).toBe(422);
  });

  it('links validate target existence, patient match, and duplicates', async () => {
    const { service, published } = await activeWorld();
    const draft = await service.createFinding(baseFinding);

    const missing = await service
      .linkFinding(draft.id, { targetType: 'observation', targetId: X })
      .catch((e: unknown) => e);
    expect(status(missing)).toBe(400);
    expect(codeOf(missing)).toBe('LINK_TARGET_NOT_FOUND');

    const wrongPatient = await service
      .linkFinding(draft.id, { targetType: 'encounter', targetId: E_OTHER })
      .catch((e: unknown) => e);
    expect(status(wrongPatient)).toBe(400);
    expect(codeOf(wrongPatient)).toBe('LINK_PATIENT_MISMATCH');

    const link = await service.linkFinding(draft.id, {
      targetType: 'encounter',
      targetId: E,
    });
    expect(link.findingId).toBe(draft.id);
    expect(published.map((e) => e.type)).toContain('anatomy.finding_linked');

    const dup = await service.linkFinding(draft.id, {
      targetType: 'encounter',
      targetId: E,
    });
    expect(dup.id).toBe(link.id);
  });

  it('listFindings requires UUID patientId (400)', async () => {
    const { service } = svc();
    const err = await service.listFindings({ patientId: 'nope' }).catch((e: unknown) => e);
    expect(status(err)).toBe(400);
  });

  it('clientRef makes create idempotent', async () => {
    const { service } = await activeWorld();
    const a = await service.createFinding({ ...baseFinding, clientRef: 'ref-1' });
    const b = await service.createFinding({ ...baseFinding, clientRef: 'ref-1' });
    expect(b.id).toBe(a.id);
  });
});
