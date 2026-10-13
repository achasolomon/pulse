import { ReportsService } from './reports.service.js';
import type { ReportsRepository } from '../domain/reports.repository.js';

describe('ReportsService (unit, fake repo)', () => {
  const repo: ReportsRepository = {
    census: async () => [
      { status: 'admitted', count: 3 },
      { status: 'open', departmentId: 'd1', count: 2 },
    ],
    revenue: async () => ({ charges: 100, invoiced: 90, paid: 40, outstanding: 50 }),
    claimAging: async () => [
      { status: 'submitted', count: 2 },
      { status: 'denied', count: 1 },
    ],
  };

  it('returns census rows passthrough', async () => {
    const svc = new ReportsService(repo);
    const rows = await svc.census('f1');
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(5);
  });

  it('returns revenue summary and claim aging', async () => {
    const svc = new ReportsService(repo);
    await expect(svc.revenue('f1', '2026-01-01', '2026-12-31')).resolves.toMatchObject({
      outstanding: 50,
    });
    await expect(svc.claims('f1')).resolves.toHaveLength(2);
  });
});
