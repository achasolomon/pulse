import { NextResponse } from 'next/server';
import { ApiError } from '@pulse/api-client';
import { validatedSession, SESSION_COOKIE } from '../../../../lib/session.js';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const verified = await validatedSession();
    if (!verified) {
      const response = NextResponse.json({ message: 'Not signed in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    return NextResponse.json(verified.publicSession, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ message: 'Staff session verification is temporarily unavailable',
      ...(err instanceof ApiError ? { correlationId: err.correlationId } : {}) },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
