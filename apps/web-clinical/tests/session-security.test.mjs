import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSession, decodeSession, SESSION_MAX_AGE_S } from '../lib/session-codec.ts';
import { isSameOrigin } from '../lib/csrf.ts';

const secret = 'test-only-session-key-with-at-least-32-characters';
const session = () => ({ token: `staff_${'a'.repeat(64)}`, sessionId: 's1', expiresAt: Date.now() + 60_000 });

test('authenticated encryption conceals token and round-trips trusted metadata', async () => {
  const data = session();
  const first = await encodeSession(data, secret), second = await encodeSession(data, secret);
  assert.notEqual(first, second);
  assert.ok(!first.includes(data.token));
  assert.deepEqual(await decodeSession(first, secret), data);
});
test('malformed and former unsigned cookies never authenticate', async () => {
  for (const value of [undefined, 'invalid', Buffer.from(JSON.stringify(session())).toString('base64url'), 'v2.a.a', 'v1.a.a', 'x'.repeat(4097)]) {
    assert.equal(await decodeSession(value, secret), null);
  }
});
test('ciphertext, nonce, version and encryption-key tampering are denied', async () => {
  const raw = await encodeSession(session(), secret), [version, nonce, encrypted] = raw.split('.');
  const alter = (s) => (s[0] === 'a' ? 'b' : 'a') + s.slice(1);
  assert.equal(await decodeSession(`${version}.${nonce}.${alter(encrypted)}`, secret), null);
  assert.equal(await decodeSession(`${version}.${alter(nonce)}.${encrypted}`, secret), null);
  assert.equal(await decodeSession(raw, 'different-test-key-with-at-least-32-characters'), null);
});
test('expiry and absolute lifetime are enforced without renewing on facility switch', async () => {
  const data = session(), raw = await encodeSession(data, secret);
  assert.equal(await decodeSession(raw, secret, data.expiresAt), null);
  await assert.rejects(encodeSession({ ...data, expiresAt: Date.now() + (SESSION_MAX_AGE_S + 10) * 1000 }, secret));
  const selected = { ...data, facilityId: '11111111-1111-4111-8111-111111111111' };
  assert.equal((await decodeSession(await encodeSession(selected, secret), secret)).expiresAt, data.expiresAt);
});
test('invalid token, facility and expiry shapes fail closed', async () => {
  for (const change of [{ token: 'staff_bad' }, { facilityId: 'not-an-id' }, { expiresAt: NaN }, { sessionId: '' }]) {
    await assert.rejects(encodeSession({ ...session(), ...change }, secret));
  }
  await assert.rejects(encodeSession(session(), 'short'));
});
test('CSRF requires complete same-origin scheme, host and port', () => {
  const previous = process.env.PULSE_APP_ORIGIN;
  delete process.env.PULSE_APP_ORIGIN;
  try {
    for (const origin of ['https://app.test', 'http://app.test', 'https://app.test:8443', 'https://evil.test', 'null', undefined]) {
      const request = new Request('https://app.test/api/auth/login', { method: 'POST', headers: origin ? { origin } : {} });
      assert.equal(isSameOrigin(request), origin === 'https://app.test');
    }
    process.env.PULSE_APP_ORIGIN = 'https://public.test';
    assert.equal(isSameOrigin(new Request('http://internal:3001/api/auth/login', { headers: { origin: 'https://public.test' } })), true);
    assert.equal(isSameOrigin(new Request('http://internal:3001/api/auth/login', { headers: { origin: 'http://internal:3001' } })), false);
  } finally {
    if (previous === undefined) delete process.env.PULSE_APP_ORIGIN;
    else process.env.PULSE_APP_ORIGIN = previous;
  }
});
