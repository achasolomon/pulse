import { NextResponse } from 'next/server';
import { ApiError } from '@pulse/api-client';
import { serverAuth } from '../../../../lib/api.js';
import { isSameOrigin } from '../../../../lib/csrf.js';
import { readSession, SESSION_COOKIE } from '../../../../lib/session.js';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: 'Cross-origin request rejected' }, { status: 403 });
  }
  const session = await readSession();
  if (session) {
    try {
      await serverAuth(session.token).logout();
    } catch (err) {
      // An already invalid session needs only local cleanup. Otherwise retain
      // the cookie so sign-out can be retried instead of claiming revocation.
      if (!(err instanceof ApiError && err.status === 401)) {
        return NextResponse.json({ message: 'Sign-out is temporarily unavailable. Please try again.',
          ...(err instanceof ApiError ? { correlationId: err.correlationId } : {}) },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
    }
  }
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
