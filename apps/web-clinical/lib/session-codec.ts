/** Authenticated encryption is shared by Edge middleware and Node routes.
 * Backend validity/revocation checks remain mandatory on protected reads. */
export const SESSION_COOKIE = 'pulse_session';
export const SESSION_MAX_AGE_S = 8 * 60 * 60;
export interface SessionData {
  token: string;
  sessionId: string;
  expiresAt: number;
  facilityId?: string;
}
const AAD = new TextEncoder().encode('pulse.staff-session.v1');
export function sessionSecret(): string {
  const secret = process.env['PULSE_SESSION_SECRET'];
  if (!secret || secret.length < 32) throw new Error('PULSE_SESSION_SECRET must contain at least 32 characters');
  return secret;
}
async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('Session secret is too short');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid session encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
function valid(value: unknown, now: number): value is SessionData {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return typeof s['token'] === 'string' && /^staff_[a-f0-9]{64}$/.test(s['token']) &&
    typeof s['sessionId'] === 'string' && s['sessionId'].length > 0 &&
    typeof s['expiresAt'] === 'number' && Number.isFinite(s['expiresAt']) && s['expiresAt'] > now &&
    s['expiresAt'] <= now + SESSION_MAX_AGE_S * 1000 &&
    (s['facilityId'] === undefined || (typeof s['facilityId'] === 'string' &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s['facilityId'])));
}
export async function encodeSession(data: SessionData, secret = sessionSecret()): Promise<string> {
  if (!valid(data, Date.now())) throw new Error('Invalid session data');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD }, await key(secret),
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function decodeSession(raw: string | undefined, secret?: string, now = Date.now()): Promise<SessionData | null> {
  if (!raw || raw.length > 4096) return null;
  try {
    const parts = raw.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const iv = decode(parts[1]);
    if (iv.length !== 12) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD }, await key(secret ?? sessionSecret()), decode(parts[2]),
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (!valid(parsed, now)) return null;
    return { token: parsed.token, sessionId: parsed.sessionId, expiresAt: parsed.expiresAt,
      ...(parsed.facilityId ? { facilityId: parsed.facilityId } : {}) };
  } catch { return null; }
}
