import { createApiClient, createAuthApi, type ApiClient, type AuthApi } from '@pulse/api-client';

export const API_BASE_URL =
  process.env['PULSE_API_BASE_URL'] ?? 'http://localhost:3000/api/v1';

/** Server-side client factory (token/context come from the session cookie per request). */
export function serverApi(token?: string): ApiClient {
  return createApiClient({
    baseUrl: API_BASE_URL,
    context: () => (token ? { token } : {}),
  });
}

export function serverAuth(token?: string): AuthApi {
  return createAuthApi(serverApi(token));
}
