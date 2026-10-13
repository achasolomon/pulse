import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(secret, salt, KEYLEN).toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts as [string, string, string];
  const actual = scryptSync(secret, salt, KEYLEN);
  const exp = Buffer.from(expected, 'hex');
  if (actual.length !== exp.length) return false;
  return timingSafeEqual(actual, exp);
}

export function newSessionToken(): { token: string; hash: string } {
  const token = 'staff_' + randomBytes(32).toString('hex');
  const hash = scryptSync(token, 'pulse-staff-session', 32).toString('hex');
  return { token, hash };
}

export function hashToken(token: string): string {
  return scryptSync(token, 'pulse-staff-session', 32).toString('hex');
}

export const STAFF_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
