import { NextResponse } from 'next/server';
import { ApiError } from '@pulse/api-client';
import { serverAuth } from '../../../../lib/api.js';
import { isSameOrigin } from '../../../../lib/csrf.js';
import { sessionSecret } from '../../../../lib/session-codec.js';
import {
  encodeSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  toPublicSession,
} from '../../../../lib/session.js';

export const runtime = 'nodejs';

interface LoginBody {
  loginId?: unknown;
  secret?: unknown;
  totp?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: 'Cross-origin request rejected' }, { status: 403 });
  }
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }
  if (!body || typeof body.loginId !== 'string' || typeof body.secret !== 'string' || !body.loginId.trim() || !body.secret) {
    return NextResponse.json({ message: 'loginId and secret are required' }, { status: 400 });
  }

  let issuedToken: string | undefined;
  try {
    sessionSecret(); // Fail before creating a backend session if misconfigured.
    const result = await serverAuth().login({
      loginId: body.loginId,
      secret: body.secret,
      ...(typeof body.totp === 'string' ? { totp: body.totp } : {}),
    });
    issuedToken = result.token;
    const session = {
      token: result.token,
      sessionId: result.sessionId,
      expiresAt: Math.min(Date.parse(result.expiresAt), Date.now() + SESSION_MAX_AGE_S * 1000),
    };
    const context = await serverAuth(result.token).me();
    const response = NextResponse.json(toPublicSession(session, context), { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, await encodeSession(session), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_S,
    });
    return response;
  } catch (err) {
    if (issuedToken) {
      try { await serverAuth(issuedToken).logout(); } catch { /* Backend expiry bounds orphaned sessions if revocation is unavailable. */ }
    }
    if (err instanceof ApiError) {
      return NextResponse.json(
        {
          message: err.message,
          code: err.code,
          kind: err.kind,
          correlationId: err.correlationId,
        },
        { status: err.status === 0 ? 502 : err.status },
      );
    }
    return NextResponse.json({ message: 'Login failed' }, { status: 502 });
  }
}
