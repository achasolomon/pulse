// Start the same isolated stack as live-auth-smoke. Stop the API only after
// the ready message, then press Enter; keep the disposable database running.
import assert from 'node:assert/strict';
import { withStaffFixture } from './live-auth-smoke.mjs';

await withStaffFixture(async ({ loginId, secret }) => {
  const base = 'http://localhost:3017';
  const login = await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId, secret }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  console.log('Ready for fault injection: stop the temporary API on port 3047, then press Enter.');
  process.stdin.resume(); await new Promise((resolve) => process.stdin.once('data', resolve)); process.stdin.pause();
  const session = await fetch(base + '/api/auth/session', { headers: { Cookie: cookie } });
  assert.equal(session.status, 503); assert.equal(session.headers.get('set-cookie'), null);
  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Origin: base, Cookie: cookie } });
  assert.equal(logout.status, 503); assert.equal(logout.headers.get('set-cookie'), null);
  assert.ok((await logout.json()).message.includes('try again'));
  console.log('Outage smoke passed: session verification is unavailable, sign-out remains retryable, and neither route falsely clears the cookie or claims revocation.');
});
