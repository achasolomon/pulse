// Explicit opt-in: this runner writes synthetic fixtures to a disposable local DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashSecret } from "../../api/dist/modules/iam/domain/credentials.js";

export async function withStaffFixture(run, options = {}) {
  assert.ok(process.env.DATABASE_URL, "Disposable DATABASE_URL is required");
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(
    process.env.PULSE_DISPOSABLE_DB,
    "yes",
    "Explicit disposable database opt-in required",
  );
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5437");
  assert.equal(url.pathname, "/pulse");
  const db = new Pool({ connectionString: url.toString() });
  const ids = {
    organization: randomUUID(),
    facility: randomUUID(),
    otherFacility: randomUUID(),
    person: randomUUID(),
    credential: randomUUID(),
    membership: randomUUID(),
  };
  const loginId = `w02-smoke-${randomUUID()}`,
    secret = randomUUID();
  try {
    await db.query(
      "INSERT INTO org.organization (id,name,code) VALUES ($1,$2,$3)",
      [ids.organization, "W02 synthetic organization", randomUUID()],
    );
    await db.query(
      "INSERT INTO org.facility (id,organization_id,name,code) VALUES ($1,$2,$3,$4)",
      [ids.facility, ids.organization, "W02 synthetic facility", "W02"],
    );
    await db.query(
      "INSERT INTO iam.credential (id,person_id,login_id,secret_hash) VALUES ($1,$2,$3,$4)",
      [ids.credential, ids.person, loginId, hashSecret(secret)],
    );
    await db.query(
      "INSERT INTO iam.membership (id,person_id,organization_id,facility_id,roles,privileges) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        ids.membership,
        ids.person,
        ids.organization,
        ids.facility,
        ["nurse"],
        ["patient:read"],
      ],
    );
    if (options.twoFacilities) {
      await db.query(
        "INSERT INTO org.facility (id,organization_id,name,code) VALUES ($1,$2,$3,$4)",
        [
          ids.otherFacility,
          ids.organization,
          "Other W02 facility",
          "W02-OTHER",
        ],
      );
      await db.query(
        "INSERT INTO iam.membership (person_id,organization_id,facility_id,roles,privileges) VALUES ($1,$2,$3,$4,$5)",
        [ids.person, ids.organization, ids.otherFacility, ["doctor"], []],
      );
    }
    await run({ db, ids, loginId, secret });
  } finally {
    await db.query('DELETE FROM workflow.staff_notification WHERE facility_id=$1', [ids.facility]);
    await db.query('DELETE FROM workflow.staff_notification_delivery WHERE event_id IN (SELECT id FROM integration.outbox WHERE aggregate_type=\'task\' AND aggregate_id IN (SELECT id FROM workflow.task WHERE facility_id=$1))', [ids.facility]);
    await db.query('DELETE FROM integration.outbox WHERE aggregate_type=\'task\' AND aggregate_id IN (SELECT id FROM workflow.task WHERE facility_id=$1)', [ids.facility]);
    await db.query('DELETE FROM workflow.task WHERE facility_id=$1', [ids.facility]);
    await db.query("DELETE FROM iam.recovery_request WHERE credential_id=$1", [
      ids.credential,
    ]);
    await db.query("DELETE FROM iam.session WHERE credential_id=$1", [
      ids.credential,
    ]);
    await db.query("DELETE FROM iam.credential WHERE id=$1", [ids.credential]);
    await db.query("DELETE FROM iam.membership WHERE id=$1", [ids.membership]);
    await db.query(
      "DELETE FROM iam.membership WHERE person_id=$1 AND facility_id=$2",
      [ids.person, ids.otherFacility],
    );
    await db.query("DELETE FROM org.facility WHERE id=$1", [ids.otherFacility]);
    await db.query("DELETE FROM org.facility WHERE id=$1", [ids.facility]);
    await db.query("DELETE FROM org.organization WHERE id=$1", [
      ids.organization,
    ]);
    await db.end();
  }
}

export async function liveAuthSmoke({ db, ids, loginId, secret }) {
  const base = "http://localhost:3017";
  const request = (path, cookie, body, origin = base) =>
    fetch(base + path, {
      redirect: "manual",
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              ...(origin ? { Origin: origin } : {}),
            }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const cookieOf = (res) => {
    const header = res.headers.get("set-cookie");
    assert.ok(header?.includes("HttpOnly"));
    assert.ok(header.includes("SameSite=lax"));
    assert.ok(header.includes("Secure"));
    return header.split(";")[0];
  };
  assert.equal((await request("/")).status, 307);
  assert.equal((await request("/", "pulse_session=forged")).status, 307);
  assert.equal((await request("/login", "pulse_session=forged")).status, 200);
  for (const origin of ["", "https://localhost:3017", "http://evil.example"])
    assert.equal(
      (await request("/api/auth/login", null, {}, origin)).status,
      403,
    );
  assert.equal((await request("/api/auth/login", null, null)).status, 400);
  const res = await request("/api/auth/login", null, { loginId, secret });
  assert.equal(res.status, 200);
  let cookie = cookieOf(res);
  assert.ok(cookie.startsWith("pulse_session=v1."));
  const publicSession = await res.json();
  assert.equal(publicSession.loginId, loginId);
  assert.equal(publicSession.facility, null);
  assert.equal(publicSession.facilities.length, 1);
  assert.ok(!JSON.stringify(publicSession).includes("staff_"));
  assert.ok(!JSON.stringify(publicSession).includes(secret));
  assert.ok(
    res.headers
      .get("cache-control")
      ?.split(",")
      .map((s) => s.trim())
      .includes("no-store"),
  );
  const home = await request("/", cookie);
  assert.equal(home.status, 200);
  assert.ok(
    (await home.text()).includes("Choose a facility to open your workspace"),
  );
  assert.equal((await request("/select-facility", cookie)).status, 307);
  assert.equal(
    (await request("/api/auth/facility", cookie, { facilityId: randomUUID() }))
      .status,
    403,
  );
  const selected = await request("/api/auth/facility", cookie, {
    facilityId: ids.facility,
  });
  assert.equal(selected.status, 200);
  cookie = cookieOf(selected);
  const html = await (await request("/", cookie)).text();
  assert.ok(html.includes("W02 synthetic facility"));
  assert.ok(html.includes("Clinical worklists are not yet available"));
  const session = await (await request("/api/auth/session", cookie)).json();
  assert.equal(session.facility.facilityId, ids.facility);
  assert.ok(session.expiresAt <= publicSession.expiresAt);
  assert.equal(
    (await request("/", cookie.slice(0, -8) + "xxxxxxxx")).status,
    307,
  );
  await db.query("UPDATE iam.membership SET effective_to=now() WHERE id=$1", [
    ids.membership,
  ]);
  assert.equal(
    (await (await request("/api/auth/session", cookie)).json()).facilities
      .length,
    0,
  );
  assert.equal((await request("/", cookie)).status, 200);
  await db.query("UPDATE iam.membership SET effective_to=NULL WHERE id=$1", [
    ids.membership,
  ]);
  const logout = await request("/api/auth/logout", cookie, {});
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));
  assert.equal((await request("/api/auth/session", cookie)).status, 401);
  assert.equal((await request("/", cookie)).status, 307);
  assert.equal((await request("/login", cookie)).status, 200);
  const sessions = await db.query(
    "SELECT revoked_at FROM iam.session WHERE credential_id=$1",
    [ids.credential],
  );
  assert.ok(sessions.rows.length);
  assert.ok(sessions.rows.every((s) => s.revoked_at));
  console.log(
    "Live BFF smoke passed: origin/body validation, opaque cookie, server identity, facility restrictions, membership refresh, tampering, logout/revocation and login recovery.",
  );
}
if (process.argv[1]?.endsWith("live-auth-smoke.mjs"))
  await withStaffFixture(liveAuthSmoke);
