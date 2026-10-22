import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClientContext } from './client.js';
import { createAuthApi } from './auth.js';
import { ApiError, problemToApiError } from './errors.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeClient(fetchImpl: typeof fetch, context?: () => ApiClientContext) {
  return createApiClient({
    baseUrl: 'http://api.test/api/v1',
    fetchImpl,
    ...(context ? { context } : {}),
    newCorrelationId: () => 'corr-test-1',
  });
}

describe('createApiClient', () => {
  it('distinguishes contradictory allergy declarations from stale revisions without exposing clinical detail',()=>{
    const contradiction=problemToApiError({status:409,code:'ALLERGY_NEGATIVE_CONFLICT',detail:'Restricted clinical narrative'});
    expect(contradiction.message).toMatch(/conflicts with active allergy records/);
    expect(contradiction.message).not.toMatch(/Reload|Restricted clinical narrative/);
    const stale=problemToApiError({status:409,code:'ALLERGY_REVISION_CONFLICT'});
    expect(stale.message).toMatch(/text is kept/);
    expect(stale.message).toMatch(/close and reopen/);
  });
  it('sends correlation, auth, tenant/facility headers and parses JSON', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    const client = makeClient(fetchMock as unknown as typeof fetch, () => ({
      token: 'staff_abc',
      tenantId: 'tenant-1',
      facilityId: 'facility-1',
    }));
    const out = await client.request<{ ok: boolean }>('/thing', { patientId: 'patient-1' });
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/thing');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-correlation-id']).toBe('corr-test-1');
    expect(headers['authorization']).toBe('Bearer staff_abc');
    expect(headers['x-tenant-id']).toBe('tenant-1');
    expect(headers['x-facility-id']).toBe('facility-1');
    expect(headers['x-patient-id']).toBe('patient-1');
  });

  it('maps ProblemDetails to ApiError with safe message, code and correlation', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, {
        title: 'Unauthorized',
        status: 401,
        code: 'STAFF_AUTH_FAILED',
        detail: 'Invalid credentials',
        correlationId: 'corr-from-server',
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.request('/x', { method: 'POST', body: {} })).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      kind: 'unauthenticated',
      code: 'STAFF_AUTH_FAILED',
      correlationId: 'corr-from-server',
      message: 'Incorrect username or password.',
    });
  });

  it('flags 409 as conflict for reload/reconcile and keeps field errors', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, {
        title: 'Conflict',
        status: 409,
        code: 'RECORD_CHANGED',
        errors: { version: ['expected 3'] },
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const err = await client.request('/x').catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('conflict');
    expect((err as ApiError).fieldErrors).toEqual({ version: ['expected 3'] });
    expect((err as ApiError).message).toMatch(/Reload/);
  });

  it('403 explains without leaking restricted detail and 400 maps to validation', async () => {
    const forbidden = problemToApiError({
      status: 403,
      code: 'ACCESS_DENIED',
      detail: 'Denied: no care relationship',
    });
    expect(forbidden.kind).toBe('forbidden');
    expect(forbidden.message).toBe('You do not have permission to perform this action.');
    expect(forbidden.message).not.toMatch(/care relationship/);
    const validation = problemToApiError({ status: 400, code: 'VALIDATION' });
    expect(validation.kind).toBe('validation');
  });

  it('maps STAFF_MFA_REQUIRED to mfa-required kind', () => {
    const err = problemToApiError({ status: 401, code: 'STAFF_MFA_REQUIRED' });
    expect(err.kind).toBe('mfa-required');
    expect(err.message).toMatch(/authenticator/);
  });

  it('supports AbortSignal cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const promise = client.request('/slow', { signal: controller.signal });
    controller.abort();
    const err = await promise.catch((e: ApiError) => e);
    expect((err as ApiError).kind).toBe('aborted');
  });

  it('wraps network failures with correlation id', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const err = await client.request('/x').catch((e: ApiError) => e);
    expect((err as ApiError).kind).toBe('network');
    expect((err as ApiError).correlationId).toBe('corr-test-1');
    expect((err as ApiError).message).toMatch(/reach the Pulse service/);
  });

  it('resolves 204 and empty bodies to undefined', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.request('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('auth api posts login body and logout with bearer token', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { token: 'staff_tok', sessionId: 'sess-1', personId: 'p-1' }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch, () => ({
      token: 'staff_tok',
    }));
    const auth = createAuthApi(client);
    const login = await auth.login({ loginId: 'dr.tan', secret: 'supersecret1', totp: '123456' });
    expect(login).toEqual({ token: 'staff_tok', sessionId: 'sess-1', personId: 'p-1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/iam/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      loginId: 'dr.tan',
      secret: 'supersecret1',
      totp: '123456',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { revoked: true }));
    const out = await auth.logout();
    expect(out).toEqual({ revoked: true });
    const [, logoutInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(logoutInit.method).toBe('POST');
  });
});
