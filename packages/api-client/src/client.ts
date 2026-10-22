import {
  abortedError,
  networkError,
  problemToApiError,
  type ProblemDetails,
} from './errors.js';

export const CORRELATION_HEADER = 'x-correlation-id';
export const TENANT_HEADER = 'x-tenant-id';
export const FACILITY_HEADER = 'x-facility-id';
export const PATIENT_HEADER = 'x-patient-id';

export interface ApiClientContext {
  token?: string | null;
  tenantId?: string | null;
  facilityId?: string | null;
  patientId?: string | null;
}

export interface ApiClientOptions {
  /** API origin including version prefix, e.g. http://localhost:3000/api/v1 */
  baseUrl: string;
  /** Per-request session/tenant context; called at request time so logout/switch take effect. */
  context?: () => ApiClientContext;
  fetchImpl?: typeof fetch;
  newCorrelationId?: () => string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Cancellation (FE-001 §24: searches must be cancellable). */
  signal?: AbortSignal;
  correlationId?: string;
  headers?: Record<string, string>;
  /** Override context patient header for patient-scoped calls. */
  patientId?: string;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  readonly baseUrl: string;
}

function defaultCorrelationId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function parseProblem(res: Response): Promise<ProblemDetails> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      return {
        ...(typeof b['title'] === 'string' ? { title: b['title'] } : {}),
        ...(typeof b['status'] === 'number' ? { status: b['status'] } : { status: res.status }),
        ...(typeof b['detail'] === 'string' ? { detail: b['detail'] } : {}),
        ...(typeof b['instance'] === 'string' ? { instance: b['instance'] } : {}),
        ...(typeof b['code'] === 'string' ? { code: b['code'] } : {}),
        ...(typeof b['correlationId'] === 'string' ? { correlationId: b['correlationId'] } : {}),
        ...(b['errors'] && typeof b['errors'] === 'object'
          ? { errors: b['errors'] as Record<string, string[]> }
          : {}),
      };
    }
    return { status: res.status };
  } catch {
    return { status: res.status };
  }
}

/**
 * Central Pulse API client (FE-001 §24): auth, correlation, tenant/facility
 * context headers and ProblemDetails error mapping live here — components
 * never scatter raw fetch. Responses of 204/empty bodies resolve to undefined.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const newCorrelationId = options.newCorrelationId ?? defaultCorrelationId;

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const ctx = options.context?.() ?? {};
    const correlationId = opts.correlationId ?? newCorrelationId();
    const url = `${options.baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      accept: 'application/json',
      [CORRELATION_HEADER]: correlationId,
      ...opts.headers,
    };
    if (ctx.token) headers['authorization'] = `Bearer ${ctx.token}`;
    if (ctx.tenantId) headers[TENANT_HEADER] = ctx.tenantId;
    if (ctx.facilityId) headers[FACILITY_HEADER] = ctx.facilityId;
    const patientId = opts.patientId ?? ctx.patientId;
    if (patientId) headers[PATIENT_HEADER] = patientId;

    let payload: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: opts.method ?? 'GET',
        cache: 'no-store',
        headers,
        ...(payload !== undefined ? { body: payload } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      if (opts.signal?.aborted) throw abortedError();
      throw networkError(correlationId, err);
    }

    if (!res.ok) throw problemToApiError(await parseProblem(res), correlationId);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  return { request, baseUrl: options.baseUrl };
}

export { ApiError } from './errors.js';
