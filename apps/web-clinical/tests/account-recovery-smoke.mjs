import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withStaffFixture } from "./live-auth-smoke.mjs";
const base = "http://localhost:3017";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const call = (action, body, cookie) =>
  fetch(base + "/api/auth/" + action, {
    method: "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const getCookie = (r) => r.headers.get("set-cookie").split(";")[0];
await withStaffFixture(async ({ db, ids, loginId, secret }) => {
  assert.equal((await fetch(base + "/forgot-password")).status, 200);
  assert.equal((await fetch(base + "/reset-password")).status, 200);
  const login = await call("login", { loginId, secret });
  assert.equal(login.status, 200);
  const cookie = getCookie(login);
  const unknown = await call("account/password-request", {
    loginId: "unknown-" + randomUUID(),
  });
  const unverified = await call("account/password-request", { loginId });
  assert.equal(unknown.status, 200);
  assert.deepEqual(await unknown.json(), await unverified.json());
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM iam.recovery_request WHERE credential_id=$1",
          [ids.credential],
        )
      ).rows[0].count,
    ),
    0,
  );
  assert.equal(
    (
      await call(
        "account/email-request",
        { email: "owner@pulse.test", secret: "incorrect-secret" },
        cookie,
      )
    ).status,
    400,
  );
  const email = `recovery-${randomUUID()}@pulse.test`;
  assert.equal(
    (await call("account/email-request", { email, secret }, cookie)).status,
    200,
  );
  async function mailToken(subject, exclude = "") {
    for (let i = 0; i < 120; i++) {
      const response = await fetch(
        "http://127.0.0.1:8026/api/v2/messages?limit=100",
      );
      const data = await response.json();
      for (const mail of data.items ?? []) {
        if (
          !mail.Content.Headers.To?.some((to) => to.includes(email)) ||
          !mail.Content.Headers.Subject?.some((s) => s.includes(subject))
        )
          continue;
        const encoding =
          mail.Content.Headers["Content-Transfer-Encoding"]?.[0]?.toLowerCase();
        const text =
          encoding === "base64"
            ? Buffer.from(mail.Content.Body, "base64").toString()
            : mail.Content.Body.replace(/=\r?\n/g, "").replace(
                /=([0-9A-F]{2})/gi,
                (_match, hex) => String.fromCharCode(parseInt(hex, 16)),
              );
        const token = text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
        if (token && token !== exclude) return token;
      }
      await delay(250);
    }
    assert.fail("Recovery test email did not arrive in local inbox");
  }
  const verifyToken = await mailToken("Verify");
  await withStaffFixture(async (other) => {
    const second = await call("login", {
      loginId: other.loginId,
      secret: other.secret,
    });
    assert.equal(second.status, 200);
    const otherCookie = getCookie(second);
    assert.equal(
      (await call("account/email-verify", { token: verifyToken }, otherCookie))
        .status,
      400,
    );
    assert.equal((await call("logout", {}, otherCookie)).status, 200);
  });
  assert.equal(
    (await call("account/email-verify", { token: verifyToken }, cookie)).status,
    200,
  );
  assert.equal(
    (await call("account/email-verify", { token: verifyToken }, cookie)).status,
    400,
  );
  const security = await (
    await fetch(base + "/api/auth/account/security", {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(security.emailVerified, true);
  assert.equal(security.recoveryEmail, email);
  assert.equal(
    (await call("account/password-request", { loginId })).status,
    200,
  );
  const expired = await mailToken("Reset");
  await db.query(
    "UPDATE iam.recovery_request SET expires_at=now()-interval '1 minute' WHERE credential_id=$1 AND purpose='password_reset'",
    [ids.credential],
  );
  const newSecret = randomUUID();
  assert.equal(
    (
      await call("account/password-reset", {
        token: expired,
        secret: newSecret,
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("account/password-request", { loginId })).status,
    200,
  );
  const token = await mailToken("Reset", expired);
  const results = await Promise.all([
    call("account/password-reset", { token, secret: newSecret }),
    call("account/password-reset", { token, secret: newSecret }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal(
    (await fetch(base + "/api/auth/session", { headers: { Cookie: cookie } }))
      .status,
    401,
  );
  assert.equal((await call("login", { loginId, secret })).status, 401);
  const fresh = await call("login", { loginId, secret: newSecret });
  assert.equal(fresh.status, 200);
  assert.equal((await call("logout", {}, getCookie(fresh))).status, 200);
  console.log(
    "Recovery smoke passed: non-enumerating request, verified email ownership, SMTP delivery, expiry, concurrent single-use reset, session revocation and new-password login.",
  );
});
