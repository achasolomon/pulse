import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Portal auth domain (EPIC-19). scrypt password hashing + opaque sessions, stdlib only. */

const SCRYPT_KEYLEN = 64;

export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts as [string, string, string];
  const actual = scryptSync(secret, salt, SCRYPT_KEYLEN);
  const exp = Buffer.from(expected, 'hex');
  if (actual.length !== exp.length) return false;
  return timingSafeEqual(actual, exp);
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  const hash = scryptSync(token, 'pulse-portal-session', 32).toString('hex');
  return { token, hash };
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface PortalSession {
  sessionId: string;
  accountId: string;
  actingPatientId: string;
  scopes: string[];
  proxyAccountId?: string;
}

export const PORTAL_REPOSITORY = 'PORTAL_REPOSITORY';

export interface PortalRepository {
  createAccount(input: { patientId: string; loginId: string; secretHash: string }): Promise<{ id: string }>;
  findAccountByLogin(loginId: string): Promise<
    { id: string; patientId: string; secretHash: string; status: string } | undefined
  >;
  createSession(input: {
    accountId: string;
    tokenHash: string;
    actingPatientId: string;
    scopes: string[];
    expiresAt: Date;
  }): Promise<{ id: string }>;
  findSession(tokenHash: string): Promise<PortalSession | undefined>;
  revokeSession(id: string): Promise<void>;
  grantProxy(input: {
    dependentPatientId: string;
    proxyAccountId: string;
    relationship: string;
    scopes: string[];
  }): Promise<{ id: string }>;
  findGrant(dependentPatientId: string, proxyAccountId: string): Promise<
    { scopes: string[]; active: boolean } | undefined
  >;
}
