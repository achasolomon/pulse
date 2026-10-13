import { SiemService } from './siem.service.js';
import {
  decodeSecurityCursor,
  encodeSecurityCursor,
  type SecurityEventRepository,
} from '../domain/security-event.repository.js';

describe('security cursor codec', () => {
  it('round-trips; empty decodes to beginning; garbage throws', () => {
    expect(decodeSecurityCursor('')).toEqual({});
    const c = { lastOccurredAt: '2026-01-01T00:00:00.000Z', lastId: 'x' };
    expect(decodeSecurityCursor(encodeSecurityCursor(c))).toEqual(c);
    expect(() => decodeSecurityCursor('!!!')).toThrow('SECURITY_CURSOR_INVALID');
  });
});

describe('SiemService (unit, fakes)', () => {
  function fakeRepo() {
    const calls: Record<string, unknown> = {};
    const repo: SecurityEventRepository = {
      feed: async (since, limit, filter) => {
        calls.feed = { since, limit, filter };
        return {
          events: [
            {
              id: 'e1',
              occurredAt: '2026-10-12T00:00:00.000Z',
              category: 'authn',
              action: 'authn.credential_rejected',
              severity: 'medium',
              actorType: 'unknown',
              details: { status: 401 },
            },
          ],
          cursor: { lastOccurredAt: '2026-10-12T00:00:00.000Z', lastId: 'e1' },
        };
      },
      repeatedAuthFailures: async (input) => {
        calls.auth = input;
        return [{ actorId: 'attacker', failures: 12, lastSeenAt: '2026-10-12T00:10:00.000Z' }];
      },
      massPatientTouches: async (input) => {
        calls.touches = input;
        return [{ actorId: 'p1', touches: 40, lastSeenAt: '2026-10-12T00:12:00.000Z' }];
      },
    };
    return { calls, repo };
  }

  it('feed decodes cursor, applies limit/filter, encodes next cursor', async () => {
    const { calls, repo } = fakeRepo();
    const s = new SiemService(repo);
    const cursorIn = encodeSecurityCursor({ lastId: 'prev' });
    const res = await s.feed(cursorIn, 50, { severity: 'high' });
    expect(calls.feed).toMatchObject({
      since: { lastId: 'prev' },
      limit: 50,
      filter: { severity: 'high' },
    });
    expect(res.events).toHaveLength(1);
    expect(decodeSecurityCursor(res.cursor)).toEqual({
      lastOccurredAt: '2026-10-12T00:00:00.000Z',
      lastId: 'e1',
    });
  });

  it('detections computes 15-minute windows and thresholds', async () => {
    const { calls, repo } = fakeRepo();
    const s = new SiemService(repo);
    const now = new Date('2026-10-12T00:15:00Z');
    const res = await s.detections(now);
    expect(res.windowMinutes).toBe(15);
    expect(calls.auth).toEqual({
      since: new Date('2026-10-12T00:00:00Z'),
      threshold: 10,
    });
    expect(calls.touches).toEqual({
      since: new Date('2026-10-12T00:00:00Z'),
      threshold: 25,
    });
    expect(res.repeatedAuthFailures[0]?.failures).toBe(12);
    expect(res.massPatientTouches[0]?.touches).toBe(40);
  });
});
