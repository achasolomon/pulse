import { createHmac, randomBytes } from 'node:crypto';

/**
 * TOTP (RFC 6238, SHA-1, 30s step, 6 digits), stdlib only. Used for MFA
 * enrollment/verification (IAM-001 section 8, EPIC-03 F03.1 MFA-ready).
 */

const STEP_SECONDS = 30;
const DIGITS = 6;

export function newTotpSecret(): string {
  return randomBytes(20).toString('base64');
}

export function otpauthUrl(secret: string, label: string, issuer = 'Pulse'): string {
  const params = new URLSearchParams({
    secret: secret.replace(/=+$/, ''),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}

export function totpAt(secret: string, atMs: number = Date.now()): string {
  const key = Buffer.from(secret, 'base64');
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(msg).digest();
  const offset = byteAt(hmac, hmac.length - 1) & 0x0f;
  const bin =
    ((byteAt(hmac, offset) & 0x7f) << 24) |
    (byteAt(hmac, offset + 1) << 16) |
    (byteAt(hmac, offset + 2) << 8) |
    byteAt(hmac, offset + 3);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

function byteAt(buffer: Buffer, index: number): number {
  const value: number | undefined = buffer[index];
  return value ?? 0;
}

/** Accepts the current step plus ±1 for clock skew. Constant-shape result. */
export function verifyTotp(secret: string, code: string, atMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  for (const skew of [-1, 0, 1]) {
    if (totpAt(secret, atMs + skew * STEP_SECONDS * 1000) === code) return true;
  }
  return false;
}
