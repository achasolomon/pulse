# Staff notifications: review and delivery plan

Reviewed 2026-10-14. This is a scoped implementation proposal, not evidence of working notification delivery.

## Critical laboratory update — 2026-10-22

The manual laboratory workflow now has a separate durable critical-case worklist and header indicator. Independent laboratory confirmation pins the report and names an eligible clinician; actual contact/read-back evidence, explicit named clinician acknowledgement and final laboratory publication are separate actions. Counts refresh every 15 seconds while active and opening a case never acknowledges it. Pending cases remain visible to laboratory duty staff after encounter closure or recipient access withdrawal. This does not extend the ordinary task bell into a clinical delivery service. Configured backup routing, reassignment, automatic timers/escalation and external transports remain pending; direct facility escalation remains required. See [SPRINT_W06](sprints/SPRINT_W06.md) for implementation boundaries and verification.

The subsequent backup slice adds per-case named cover, immediate activation or activation at the existing follow-up deadline, and a durable five-second worker. Eligibility is checked again at activation; blocked recipients remain visible to laboratory staff and the case stays unresolved. Original responsibility is retained, contacts/read-back are recipient-specific, and first acknowledgement cancels pending activation. Facility-wide policy/rota management, routing amendments, external transports and delivery guarantees remain pending. The dedicated clinical worklist remains separate from ordinary notification read/unread state.

## Implementation update — first delivery slice

The staff inbox foundation and one real nonclinical task-assignment flow are now implemented. The review below records the starting gaps; this update supersedes its pending status for this slice only.

- Migration 0035 adds scoped, per-recipient inbox records and a separate durable consumer checkpoint. Task assignment, its event and authenticated actor audit commit together.
- The in-app consumer runs every five seconds while a database-backed API instance is running. Concurrent instances claim events inside a retained transaction; insertion and checkpoint commit together. Delivery is independent of global outbox `published_at` and is deduplicated by event/recipient. Pending events survive API downtime. This is a database-backed consumer in the modular API, not a deployed external broker worker.
- `POST /api/v1/workflow/staff/tasks` accepts `kind` and `assigneeId`, requires `task:create`, and verifies an active recipient in the selected organization/facility. This initial endpoint creates nonclinical tasks only; it accepts no patient payload. Existing generic task/notify endpoints retain their previous behavior and do not automatically feed this inbox.
- Authenticated own-inbox APIs list notifications with cursor pagination/unread count, mark one read idempotently, and resolve an assigned task destination. Scope comes from current memberships; BFF scope comes from the encrypted session, not browser-supplied tenant/recipient values.
- The header bell, recent preview, `/notifications` inbox with All/Unread filters, and `/tasks/[id]` detail are connected to those APIs. Visible clients refresh every 30 seconds and on focus/reconnect visibility; this is not Web Push. Read changes refresh the bell and inbox. Failed loads show unavailable rather than a zero count.
- Task completion controls, reassignment, department/team routing, clinical events, urgent/critical tiers, escalation timers, SMS/email/Web Push, preferences and administrative delivery monitoring remain subsequent slices. A read notification does not complete work. No critical-alert delivery guarantee is claimed.

Evidence: five real PostgreSQL/HTTP integration tests cover authentication, scope/recipient isolation, invalid recipients, assignment audit, concurrent/repeated workers, global-publication independence, pagination, read-versus-complete and revoked membership. A Chrome test verifies automatic event delivery, bell count, BFF private responses, read update, task deep link, unread filter, single-hospital header and mobile layout. Existing 283 backend unit, 105 HTTP and 11 API-client tests pass; API/web builds and lint/type checks are recorded with the change.

## Conclusion

Pulse needs an authenticated, facility-scoped staff inbox backed by durable notification records and recipient resolution. A bell alone cannot deliver work. The existing workflow module is a storage/event foundation; recipient routing, staff inbox APIs, delivery processing, unread state, and durable escalation still need implementation.

## Documentation reviewed

All top-level DOCX specifications were scanned for notification, critical-result, escalation and in-app requirements; related architecture, frontend, UX, event, IAM/privacy, safety, diagnostics, medication, referral, API and QA passages were reviewed alongside source code and sprint records.

Key requirements:

- UX-001 §24 and §72: notification centre for asynchronous work, grouped by actionability; transient toasts are for noncritical confirmations. Critical alerts need persistent acknowledgement/escalation workflows.
- FE-001 §55: notification centre with type, priority and time. Viewing a critical result must not acknowledge it.
- ARCH-001 §23: event/timer → orchestration → preferences/consent/templates/severity → delivery adapters, retry, dead letter and escalation. Safety-critical work also belongs in an accountable application queue.
- EVT-001 §35 and ADR-004: notification effects are asynchronous and replay-safe; delivered/read is separate from clinical acknowledgement; domain state and outbox events commit atomically.
- IAM-001 §61: minimal patient information in messages; links require authorization when opened, including after access revocation.
- LAB-001 critical-result workflow, IMG-001 critical findings and SAFE-001 SR-003: resolve the responsible clinician/team, record attempts and explicit acknowledgement, use durable timers and backup recipients. Downtime communication needs a documented alternative path.
- REF-001: urgent referrals require accountable review, delivery-failure handling and escalation. MED-001: medication reminders/STAT escalation and severity tiers must avoid alert fatigue.

## What exists and what is missing

| Area | Evidence in repository | Remaining work |
|---|---|---|
| Notification storage | Migration 0008: `workflow.notification` stores channel, free-text recipient/body, queued/sent/failed status and timestamp | Organization/facility scope, authenticated recipient identity, event linkage, category/priority, safe resource reference, per-recipient read state |
| Notification command | `POST /workflow/notify` writes a row and `notification.queued` event | Staff-owned list/count/read APIs; no delivery consumer found for this event |
| Task foundation | Create/list/complete/escalate task endpoints; task has facility, kind, patient, due time and status | Staff/team assignment, reliable scheduled escalation, concurrency-safe transitions, authoritative resource scope checks |
| Events | Laboratory, imaging, medication, referral, appointment, encounter and revenue services emit events | Versioned trigger catalogue, event-name reconciliation and trustworthy routing context |
| Outbox | Writer supports a caller transaction; relay exposes claim/mark methods | Running delivery loop and broker/worker handling; transactional claims or leases, bounded retries and consumer deduplication |
| Clinical acknowledgement | Lab endpoint writes `critical_ack_by`/`critical_ack_at` and emits acknowledgement event | Actor must come from authenticated context rather than submitted `ackBy`; verify critical state, ownership, authorization and concurrent acknowledgement handling |
| Frontend | Authenticated shell and selected facility are available | Header bell, preview, full inbox, filters, live updates, failure states and authorized destination pages |

Important implementation findings:

- Workflow writes and subsequent outbox calls currently execute separately; passing a transaction is supported by the outbox writer but not used here. An interrupted write can leave a record without its event.
- `OutboxRelay.claimBatch` uses `FOR UPDATE SKIP LOCKED` without a surrounding retained transaction or persistent lease. The existing method does not establish durable ownership through publication.
- `workflow.notification.recipient` is arbitrary text. It is not yet a verified staff/person assignment.
- Task reads take a caller-supplied facility query, while transitions find tasks by ID. Existing guards are not evidence that the resource belongs to the selected facility; resource checks must be explicit.
- Some event names differ from EVT-001: code uses `lab.critical_result`/`lab.critical_acknowledged`, while the specification names `lab.critical_result.identified`/`.acknowledged`. Resolve contracts before adding consumers.
- F15.2 is marked Done in the backend tracker, but its note and Sprint 09 expressly limit it to records/outbox, with delivery adapters deferred. Treat end-to-end staff delivery as pending.
- Password-recovery SMTP is a separate account-security feature; it does not implement clinical notification delivery.

## Recipient and trigger scope

These are proposed routing rules, subject to the relevant domain's ownership and facility policy. Role names alone must not broadcast patient data or confer access.

| Trigger | Primary recipient | Required action |
|---|---|---|
| Task assigned/reassigned or due | Named assignee or authorized team queue | Open, claim or complete the underlying task |
| Released lab/imaging report | Ordering/responsible clinician or covering care team | Review report |
| Critical lab/imaging finding | Responsible clinician/team and configured backup | Explicit clinical acknowledgement and follow-up; escalate if overdue |
| New lab/imaging order | Authorized facility department queue | Process order |
| Prescription needing verification/dispensing | Assigned pharmacist or pharmacy queue | Verify/dispense through medication workflow |
| Due/overdue medication or nursing task | Assigned nurse/ward team | Perform/document care; governed escalation |
| Referral received/decision/readiness change | Receiving triage team or sending coordinator, as appropriate | Review/coordinate referral |
| Appointment/queue change | Assigned reception/scheduling team | Handle scheduling or queue work |
| Claim rejection/payment exception | Assigned revenue team | Resolve financial exception |
| Security/privilege expiry or access-review event | Affected staff and authorized security/credentialing owner | Review security/access action |

Orders, reports and tasks must first support real ownership and safe destinations. Do not turn every event into a notification; subscribe only to actionable events and relevant informational changes.

## Proposed user experience

- Bell between facility context and profile, with unread count, accessible label and mobile support.
- Compact preview: priority, short summary, time, read state and destination; “View all notifications” opens the inbox.
- Inbox filters: unread/all, requires action, category and priority. Reading and action completion remain independent.
- Critical items stay visibly pending until the owning domain records acknowledgement; no disappearing toast or “mark all read” can resolve them.
- Default scope is the selected facility. A single-hospital account uses the same inbox with no facility switch. A multi-facility account resets cached items and counts when switching. Any future cross-facility summary must be explicitly authorized and identify its facility.
- Notifications may arrive while offline/logged out; durable records are shown after reconnect/login. Delivery does not depend on an open browser.
- Show loading, empty, unavailable, reconnecting and revoked-access states. Do not render a failed fetch as zero unread. No patient information in browser storage or unauthenticated previews.

## Delivery sequence

1. **Backend inbox foundation:** introduce typed recipient/scope and event references, read timestamps, priority/category and cursor pagination. Add authenticated own-inbox list/count/read endpoints through the existing BFF and typed API client. Users never supply another recipient's identity. Prove tenant/facility/recipient isolation.
2. **One complete event path:** use a real assigned task once ownership exists; commit task/event together, resolve recipients, insert inbox records idempotently with a unique event/recipient/channel key. Add durable worker claims/checkpoints independent of global outbox publication state. Do not build a projector that only peeks at unpublished events and can miss events another consumer publishes.
3. **Header/inbox UI:** bell, preview, full page, authorized deep links and read controls. Start with bounded polling while visible, refresh on focus, cancel stale requests and pause when hidden. The interval is a proposed engineering setting, not a clinical delivery SLA. Add SSE later if measured latency needs justify it; retain reconnect/resync from durable storage.
4. **Clinical routing:** connect routine released reports, orders and referrals as their read/worklist screens and ownership contracts become available. Verify actual event payloads and release policy; do not equate a raw result component event with a finalized report.
5. **Critical escalation and additional channels:** persistent timers, covering/backup recipients, explicit acknowledgement in the clinical domain, delivery attempts, bounded retry/dead letter, operational monitoring and configured email/SMS/push adapters. Facility clinical policy must define recipients and escalation deadlines; no invented thresholds.

## Acceptance evidence

Test duplicate/replayed events, crash recovery, concurrent read/acknowledgement, recipient and facility isolation, revoked membership, unsafe deep links, missed updates across reconnect, worker retry/dead letter, and escalation timer restart. Verify that reading/mark-all-read never completes a task or acknowledges a critical result. Browser checks cover keyboard/focus, mobile inbox, switch cancellation, failure versus empty states, and a real event appearing for its intended staff recipient.

Implementation starts with steps 1–2, followed by the bell/inbox. No production notification delivery or clinical escalation is claimed by this review.
