# Sprint 30 — Edge device runtime (EPIC-21 / F21.1)

**Status:** done
**Target:** close the remaining EPIC-21 story — F21.1 "Critical facility workflows survive WAN outage... no fail-open auth". Sprint 19 delivered the sync protocol (feed/apply/conflicts); this sprint delivers the **device identity layer on the central side**: enrolled edge gateways authenticate with a one-time-issued opaque device token, are bound to a single facility, and operate only within an approved local-data capability subset. Degraded mode (disconnect-window) is measured and exposed, never silently ignored.

## Scope

### Migration `0026_edge_device.sql`
- `integration.device` — facility-bound edge device/gateway registry: `kind` (`edge-gateway`|`branch-server`|`kiosk`), `status` (`active`|`suspended`|`decommissioned`), `token_hash` (sha256 of opaque `pdev_…` token, unique), `capabilities text[]` (approved local data subset: exact event type, `prefix.`, or `*`), `max_disconnected_hours`, `last_seen_at`/`last_heartbeat` (jsonb), `enrolled_at`/`decommissioned_at`. UNIQUE `(facility_id, name)`; non-empty capabilities CHECK.
- `integration.device_heartbeat` — append-only heartbeat history (pending_out/pending_in/last_sync_at/recorded_at).

### Module (`sync`)
- **Domain** `device.repository.ts`: `Device`/`DeviceRepository` port; pure guards — `eventTypeAllowed` (exact / `prefix.` / `*`), `deviceStatusAction` (suspend/resume/decommission state machine, decommission terminal), `deviceWindowExceeded` (last_seen older than max_disconnected_hours); `generateDeviceToken`/`hashDeviceToken` (sha256, `pdev_` raw token shown once).
- **DeviceService**: enroll (raw token returned once; name-taken → 409), list (with `windowExceeded` + `degraded` flags), get, suspend/resume/decommission (state machine → 409 `DEVICE_TRANSITION`), heartbeat (records pending counts, returns reconnect `windowExceeded` computed from prior last_seen), authenticate (401 `DEVICE_TOKEN_INVALID` unknown; 403 `DEVICE_SUSPENDED`/`DEVICE_DECOMMISSIONED`).
- **SyncAccessGuard**: if `x-device-token` present → device path (authenticate, facility binding: `x-facility-id` when present must match device → 403 `DEVICE_FACILITY_MISMATCH`; ALS requestContext populated from device for audit); else → delegate to `TenantContextGuard` + `AuthorizationGuard` (staff/demo path unchanged). No fail-open: unknown/suspended tokens are hard 401/403. Dev fallback (no `DATABASE_URL`): static `pulse-dev-device`.
- **SyncService**: `apply` gains optional `capabilities` — pre-validates the whole batch before any write (`SYNC_CAPABILITY_DENIED` listing offending types, no partials); `feed` gains optional type filter (SQL) and device-path consumerId default `device:<id>`.
- **Controller**: `@UseGuards(SyncAccessGuard)` on the whole controller (staff path delegates); new device endpoints — `POST sync/devices` (enroll, `sync:manage`, audited), `GET sync/devices`, `GET sync/devices/:id` (`sync:read`), `POST sync/devices/:id/{suspend,resume,decommission}` (`sync:manage`, audited), `POST sync/devices/me/heartbeat` (device token only, 401 `DEVICE_TOKEN_REQUIRED` for staff).

### Events / audit
- Outbox: `sync.device_enrolled|suspended|resumed|decommissioned` (aggregate `edge_device`, producer `sync`). Heartbeats are operational telemetry, not facts — no outbox.
- `@Audited`: enroll, suspend, resume, decommission, plus existing `sync.apply`.

## Non-goals
- Edge-side runtime deployment (the edge agent itself lives in a separate deployable; central only enforces identity/capabilities).
- Token rotation endpoint (rotate = decommission + enroll).
- Per-heartbeat alerting/history UI (rows are queryable; alerting is EPIC-23).

## Decisions
- D1 — capability matching is exact, `prefix.` (trailing dot), or `*`; default deny; validated at enroll.
- D2 — batch apply validates all event types before any write; a single out-of-scope type rejects the batch with `SYNC_CAPABILITY_DENIED` (no partial application).
- D3 — device token replaces staff session AND tenant headers on the sync surface; facility is implied by the token, with optional `x-facility-id` cross-check (mismatch -> 403 `DEVICE_FACILITY_MISMATCH`).
- D4 — watermark consumerId for a device is `device:<id>` (opaque to the device); staff path keeps caller-supplied consumerId.
- D5 — reconnect is a fact, not a gate: heartbeat reports `windowExceeded` computed from the prior `last_seen` (guard re-authenticates each request, so the service always sees a fresh row); degraded visibility per ARCH §13, no hard block.
- D6 — device lifecycle endpoints (`sync/devices`) are facility-scoped for staff: list filtered by caller facility, get/transition cross-facility -> 404/403 (least privilege until real role model).
- D7 — test isolation fix (Sprint 29 spec): `fhir-writes.integration-spec.ts` ledger queries are now partner-scoped (`partner_id = <run partner>`); previously fixed idempotency keys + unpartnered queries leaked across suite runs on a shared DB (hidden while each live proof used a fresh container).

## Evidence
| Gate | Result |
| --- | --- |
| Migration | `0026_edge_device.sql` applied live (`pulse-pg-s30`, migrations 0001-0026) |
| Integration (live PG) | **59/59** across 26 files — second consecutive run on the same DB (isolation verified); `sync-device.integration-spec.ts` 5/5 |
| Unit | **213/213** across 40 files (sync module: 24 across 4 specs, +20 new) |
| e2e (no DB) | **76/76** (+5 above sentinel: heartbeat 401, unknown token 401, facility mismatch 403, enroll 403 without `sync:manage`, enroll DTO 400) |
| tsc | 0 errors |
| oxlint | 0 warnings / 0 errors (260 files) |
| Boundaries | ok (188 files) |
| Secrets | clean |
| Build | 9/9 tasks |

Live behavior proven: enroll returns `pdev_` token once (sha256 at rest, raw never stored); feed SQL-filters to the approved subset; mixed apply batch with one out-of-scope type denies with zero writes; inbox replay dedupes; heartbeat persists pending counts + history and reports `windowExceeded` after a 25h backdate against a 24h window; suspend -> `DEVICE_SUSPENDED` 403, resume restores, decommission terminal; guard attaches facility context on device path, hard-denies mismatch and suspended tokens. Teardown: container removed, tsbuildinfo restored.
