import { NextResponse, type NextRequest } from 'next/server';
import { decodeSession, SESSION_COOKIE } from './lib/session-codec.js';

const PUBLIC_PREFIXES = ['/login', '/forgot-password', '/reset-password', '/api/auth', '/assets'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Route protection (FE-001 §7/§67): unauthenticated app routes redirect to
 * /login when cookie integrity/expiry fails. Protected server layouts also
 * validate live backend sessions; login remains reachable for recovery.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const signedIn = await decodeSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!signedIn && !isPublic(pathname)) {
    const url = new URL('/login', request.url);
    const response = NextResponse.redirect(url);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  // Keep login reachable when a backend session has been revoked. Protected
  // layouts validate against the API before rendering any workspace.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|brand|icon\\.png|favicon\\.ico).*)'],
};
