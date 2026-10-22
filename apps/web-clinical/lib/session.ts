import { cookies } from 'next/headers';
import { ApiError, type StaffContext, type StaffWebSession } from '@pulse/api-client';
import { serverAuth } from './api.js';
import { decodeSession, SESSION_COOKIE, type SessionData } from './session-codec.js';
export { encodeSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from './session-codec.js';
export type { SessionData } from './session-codec.js';
export type PublicSession = StaffWebSession;
export function readSession(): Promise<SessionData | null> {
  return decodeSession(cookies().get(SESSION_COOKIE)?.value);
}
export function toPublicSession(session: SessionData, context: StaffContext): PublicSession {
  return { loginId: context.loginId, personId: context.personId,
    expiresAt: Math.min(session.expiresAt, Date.parse(context.expiresAt)),
    facilities: context.facilities,
    facility: context.facilities.find((f) => f.facilityId === session.facilityId) ?? null };
}
export async function validatedSession(): Promise<{ session: SessionData; context: StaffContext; publicSession: PublicSession } | null> {
  const session = await readSession();
  if (!session) return null;
  try {
    const context = await serverAuth(session.token).me();
    if (context.sessionId !== session.sessionId || !Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= Date.now()) return null;
    return { session, context, publicSession: toPublicSession(session, context) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
