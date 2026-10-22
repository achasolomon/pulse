import { NextResponse } from 'next/server';
import { ApiError } from '@pulse/api-client';
import { isSameOrigin } from '../../../../lib/csrf.js';
import { encodeSession, validatedSession, SESSION_COOKIE } from '../../../../lib/session.js';

export const runtime = 'nodejs';
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Cross-origin request rejected' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Invalid request body' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>)['facilityId'] !== 'string') {
    return NextResponse.json({ message: 'Select a facility' }, { status: 400 });
  }
  try {
    const verified = await validatedSession();
    if (!verified) return NextResponse.json({ message: 'Please sign in again' }, { status: 401 });
    const facility = verified.context.facilities.find((f) => f.facilityId === (body as Record<string, unknown>)['facilityId']);
    if (!facility) return NextResponse.json({ message: 'This facility is unavailable for your account' }, { status: 403 });
    const session = { ...verified.session, expiresAt: verified.publicSession.expiresAt, facilityId: facility.facilityId };
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, await encodeSession(session), {
      httpOnly: true, secure: process.env['NODE_ENV'] === 'production', sameSite: 'lax', path: '/',
      maxAge: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    });
    return response;
  } catch (err) {
    return NextResponse.json({ message: 'Facility selection is temporarily unavailable',
      ...(err instanceof ApiError ? { correlationId: err.correlationId } : {}) }, { status: 503 });
  }
}
