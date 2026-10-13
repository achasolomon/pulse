import { FindingService } from './finding.service.js';
import {
  type Finding,
  type FindingRepository,
  type FindingStatus,
} from '../domain/finding.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

async function expectCode(p: Promise<unknown>, code: string, status?: number) {
  try {
    await p;
    throw new Error(`expected rejection ${code}`);
  } catch (err) {
    const e = err as { getResponse: () => unknown; getStatus: () => number };
    expect((e.getResponse() as { code?: string }).code).toBe(code);
    if (status !== undefined) expect(e.getStatus()).toBe(status);
  }
}

describe('FindingService (unit, fakes)', () => {
  function store() {
    const rows = new Map<string, Finding>();
    let seq = 0;
    const repo: FindingRepository = {
      create: async (input) => {
        seq += 1;
        const f: Finding = {
          id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
          title: input.title,
          severity: input.severity,
          status: 'open',
          ...(input.vector ? { vector: input.vector } : {}),
          component: input.component,
          ...(input.evidence ? { evidence: input.evidence } : {}),
          ...(input.owner ? { owner: input.owner } : {}),
          ...(input.remediation ? { remediation: input.remediation } : {}),
          foundAt: new Date().toISOString(),
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        };
        rows.set(f.id, f);
        return f;
      },
      findById: async (id) => rows.get(id),
      list: async (filter) =>
        [...rows.values()].filter(
          (f) =>
            (!filter?.status || f.status === filter.status) &&
            (!filter?.severity || f.severity === filter.severity),
        ),
      transition: async (id, status, input) => {
        const f = rows.get(id);
        if (f) {
          f.status = status;
          f.triagedAt = input.at.toISOString();
          if (input.triagedBy) f.triagedBy = input.triagedBy;
          if (input.owner) f.owner = input.owner;
          if (input.remediation) f.remediation = input.remediation;
        }
      },
    };
    return { rows, repo };
  }

  const svc = (repo: FindingRepository) =>
    new FindingService(repo, new OutboxService(undefined));

  const intakeIn = (over: Record<string, unknown> = {}) => ({
    title: 'IDOR on patient export endpoint',
    severity: 'high',
    component: 'api/patient-export',
    ...over,
  });

  it('intake validates and creates an open finding; list filters; get by id', async () => {
    const st = store();
    const s = svc(st.repo);
    const f = await s.create(intakeIn({ vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N' }));
    expect(f.status).toBe('open');
    const list = await s.list({ severity: 'high' });
    expect(list).toHaveLength(1);
    expect((await s.list({ severity: 'low' }))).toHaveLength(0);
    expect((await s.get(f.id)).id).toBe(f.id);
    await expectCode(s.get('00000000-0000-4000-8000-000000000099'), 'FINDING_NOT_FOUND', 404);
  });

  it('intake rejects bad title/component/severity/dueAt', async () => {
    const s = svc(store().repo);
    await expectCode(s.create(intakeIn({ title: 'x' })), 'FINDING_TITLE_INVALID', 400);
    await expectCode(s.create(intakeIn({ component: '' })), 'FINDING_COMPONENT_INVALID', 400);
    await expectCode(s.create(intakeIn({ severity: 'catastrophic' })), 'FINDING_SEVERITY_INVALID', 400);
    await expectCode(s.create(intakeIn({ dueAt: 'not-a-date' })), 'FINDING_DUE_INVALID', 400);
  });

  it('triage -> mitigate; closed findings are terminal (409, new finding for regressions)', async () => {
    const s = svc(store().repo);
    const f = await s.create(intakeIn());
    const triaged = await s.act(f.id, 'triage', { triagedBy: 'sec-ops', owner: 'platform-team' });
    expect(triaged.status).toBe('triaged');
    expect(triaged.owner).toBe('platform-team');
    const mitigated = await s.act(f.id, 'mitigate', { remediation: 'Added authz check + regression test' });
    expect(mitigated.status).toBe('mitigated');
    await expectCode(s.act(f.id, 'triage'), 'FINDING_TRANSITION', 409);
    await expectCode(s.act(f.id, 'accept'), 'FINDING_TRANSITION', 409);
  });

  it('accept path records decision; open can go straight to accept', async () => {
    const s = svc(store().repo);
    const f = await s.create(intakeIn({ severity: 'info' }));
    const accepted = await s.act(f.id, 'accept', {
      owner: 'security-lead',
      remediation: 'Accepted risk: internal low-traffic admin tool, compensating control documented',
    });
    expect(accepted.status).toBe('accepted');
    await expectCode(s.act(f.id, 'mitigate'), 'FINDING_TRANSITION', 409);
  });

  it('transitions on unknown id -> 404; status filter on list', async () => {
    const st = store();
    const s = svc(st.repo);
    await s.create(intakeIn({ severity: 'medium' }));
    const open = await s.list({ status: 'open' as FindingStatus });
    expect(open).toHaveLength(1);
    await expectCode(
      s.act('00000000-0000-4000-8000-000000000099', 'triage'),
      'FINDING_NOT_FOUND',
      404,
    );
  });
});
