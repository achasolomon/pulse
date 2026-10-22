import { describe, expect, it, vi } from 'vitest';
import { createStaffWebApi } from './staff-web.js';

describe('staff browser BFF transport', () => {
  it('uses only same-origin BFF endpoints, no bearer header, and private requests', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createStaffWebApi({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.login({ loginId: 'nurse', secret: 'test-only' });
    await api.session(); await api.selectFacility('facility-1'); await api.logout();
    expect(fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      '/api/auth/login', '/api/auth/session', '/api/auth/facility', '/api/auth/logout',
    ]);
    for (const call of fetchImpl.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1];
      expect(init.cache).toBe('no-store');
      expect(init.headers).not.toHaveProperty('authorization');
    }
  });
  it('maps machine MFA and revoked-session responses without parsing human copy', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'STAFF_MFA_REQUIRED', message: 'localized copy' }), { status: 401 }));
    const api = createStaffWebApi({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.login({ loginId: 'nurse', secret: 'test-only' })).rejects.toMatchObject({ kind: 'mfa-required' });
    fetchImpl.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(api.session()).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
});
