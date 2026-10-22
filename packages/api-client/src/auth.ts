import type { ApiClient } from './client.js';
import type { StaffContext } from '@pulse/api-contracts';

export interface LoginInput {
  loginId: string;
  secret: string;
  totp?: string;
}

export interface LoginResult {
  token: string;
  sessionId: string;
  expiresAt: string;
  personId?: string;
}

export interface LogoutResult {
  revoked: boolean;
}

/** Staff auth surface mirroring POST /iam/auth/login and /logout (IAM-001). */
export function createAuthApi(client: ApiClient) {
  return {
    me(): Promise<StaffContext> {
      return client.request<StaffContext>('/iam/auth/me');
    },
    login(input: LoginInput): Promise<LoginResult> {
      return client.request<LoginResult>('/iam/auth/login', {
        method: 'POST',
        body: {
          loginId: input.loginId,
          secret: input.secret,
          ...(input.totp ? { totp: input.totp } : {}),
        },
      });
    },
    logout(): Promise<LogoutResult> {
      return client.request<LogoutResult>('/iam/auth/logout', { method: 'POST' });
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
