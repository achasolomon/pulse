/**
 * CSRF defense for BFF routes (FE-001 §69): SameSite=Lax cookies plus an
 * Full Origin comparison on mutating requests. Missing/null origins fail
 * closed. Proxied deployments set PULSE_APP_ORIGIN to the public origin;
 * non-browser test clients must also supply that Origin explicitly.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const expected = new URL(process.env['PULSE_APP_ORIGIN'] ?? request.url).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}
