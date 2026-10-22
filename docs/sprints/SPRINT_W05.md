# W05 — Clinical documentation

Status: In progress. First note lifecycle slice delivered 2026-10-15.

## Delivered workflow

Open **Patient record → Clinical notes → New note**, or **Write clinical note** on the active visit when assigned. Select an eligible active encounter and note type. Nursing and consultation notes share structured reason/history/findings/assessment/plan fields without inventing recorded clinical content.

- **Save draft** persists the note with the authenticated author, type, encounter, revision and timestamps. Only its author can read/resume an unsigned draft. Draft text remains in memory while editing, not browser storage.
- **Edit draft** resumes the saved version. Updates require the expected revision; competing edits reject the stale submission. The editor retains local text on a conflict or failed request.
- **Review & sign** saves outstanding changes, presents the complete note with patient/encounter identity, identifies unrecorded fields, and requires an explicit review attestation. The server requires a reason and clinical content. Signing does not complete or discharge the visit.
- A signed note is immutable. **Add addendum** appends a separate author/time-attributed clarification, preserving the signed body and signature time. Only the author can amend in this slice, with current care access; an encounter may be closed when appending a correction.
- Unsaved changes require a discard decision on close/cancel/backdrop/Escape. The native browser navigation warning protects page exit. The drawer remains a side panel on desktop and a bottom sheet on mobile, with visible footer actions.

## Backend and scope

Migration `0038_staff_clinical_notes.sql` adds note type, revision, update time, addendum attribution and a database trigger rejecting changes to signed rows. Existing untyped notes retain the neutral `clinical` type. New UI notes are explicitly `consultation` or `nursing`.

Canonical staff routes provide note contexts, reads, create/save/sign and addenda. Every request uses the authenticated selected organization/facility and current privileges. New drafts/updates/signing require a matching active encounter, encounter-specific care assignment and visit ownership: consultation staff must own an in-consultation visit; nursing staff must own the nursing assignment. Active inpatient/emergency contexts require their explicit encounter care assignment and appropriate documentation capability. Encounter, care and visit rows are locked during documentation writes. Read scope excludes inconsistent encounter/patient/facility relationships.

Capabilities remain separate: `note:read`, `note:write`, `note:sign`, `note:amend`, with `note:nursing` for nursing notes and `encounter:consult` for consultation notes. Owning a patient care assignment alone is insufficient to document another clinician's outpatient visit. Legacy staff-authenticated note mutation routes return `STAFF_NOTE_WORKFLOW_REQUIRED`; they cannot bypass the scoped lifecycle. Existing nonstaff test/demo adapters remain unchanged.

Mutations use actor-scoped command receipts, version checks and row locks. Note state, receipt, metadata-only audit and clinical outbox event commit atomically. Receipts/events exclude clinical narratives. Note reads are audited. Signed notes and attributed addenda appear in the longitudinal history; other authors' drafts stay private.

## Verification

- Eight new PostgreSQL/HTTP lifecycle tests: context/assignment eligibility, author spoofing rejection, duplicate submissions, private drafts, concurrent/stale updates, signing attestation/current revision, database immutability, attributed/idempotent addenda, nursing notes, legacy bypass rejection, closure and care/membership revocation.
- Chrome: consultation/nursing draft entry and resume, outage retention, unsaved-change handling, conflict retention, review/attestation/signing, unchanged signed body, attributed addenda and mobile drawer/Escape behavior. Evidence: ignored `tmp/clinical-notes-evidence`.
- Run real DB verification only on disposable port 5437; `tests/clinical-notes-smoke.mjs` enforces the existing disposable-fixture opt-in and cleans its clinical records afterwards.

## Local review

The opt-in local patient preview seed enables note read/write/sign/amend for demo admin/doctor/nurse, and nursing-note capability for demo nurse/admin. It does not grant unrestricted care, alter credentials/MFA or create fictional signed clinical notes in the normal database. Use City General Hospital (Demo): the nurse claims the visit; the selected doctor starts consultation before documenting. An empty context list explains that a claim/consultation start is required.

## Remaining W05 scope

Terminology-backed diagnosis/allergen coding, verification-status revisions, allergy inactivation/refutation and broader reconciliation governance, advanced nursing care plans/templates, countersigning/delegation, note co-authoring, clinical encounter completion/discharge, orders/prescribing, production signing/governance acceptance and broader clinical documentation scope remain pending. Authored problems/diagnoses, structured allergies and initial reconciliation are delivered below; this is not completion of all clinical workflows.

## SOAP documentation workspace refinement

The note editor now uses a wider desktop side drawer and a stacked mobile bottom drawer. Subjective/Objective/Assessment/Plan tabs retain all authored sections, provide character counts and expose clear documented/empty indicators. Subjective includes the chief complaint and relevant history; section-heading actions support review of systems, medical/surgical/family/social history and the other SOAP sections. List tools edit the selected narrative section. All content remains plain text in the existing validated note fields; these headings are not separately coded diagnoses or structured negative ROS findings.

A searchable built-in template rail supplies consultation, follow-up, nursing assessment and nursing handover prompts. Applying a template appends blank headings without overwriting existing content or pre-filling clinical negatives, diagnoses or treatment. The chart-context rail previews permission-scoped vitals/calculated indicators, current/held prescriptions, active problems/allergies and verified investigation findings before a deliberate append to the selected SOAP section. Copies retain relevant timestamps, source/status, result or rule versions and formula descriptions. Missing or restricted records never become confirmed negative findings. Insertions check section limits before modifying the draft.

The workspace exposes saved/unsaved state and saved time. Existing manual save, expected-revision conflicts, private drafts, review/attestation, immutable signatures, amendments, failure retention and unsaved-change/Escape safeguards remain intact. No browser storage holds draft PHI. Rich HTML editing, custom/template administration, structured/coded ROS and medical-history capture, anatomical authoring integration and autosave remain separate work; no nonfunctional controls are shown for them.

Verification: expanded real PostgreSQL/Chrome lifecycle smoke covers template append preserving authored text, SOAP navigation, reviewed-vitals insertion, successful persistence, consultation/nursing save/resume, service outage retention, competing-revision conflicts, signing, immutable signed body, attributed addenda and mobile Escape/discard protection. Nine frontend tests and type/lint/boundary checks pass. Evidence: ignored tmp/clinical-notes-evidence. Synthetic clinical data was confined to the disposable 5437 database and cleaned afterward. Isolated 3018/3048 servers were stopped; the normal demo services remain in place.

## Rich text clinical narratives

The four SOAP narrative fields now use a real Tiptap editor with headings, bold, italic, underline, strikethrough, bulleted/numbered lists, list indentation, quotations, clear formatting and undo/redo. This supersedes the plain-text-only editor described above. Chief complaint and attributed addenda remain plain text.

Migration 0039 adds a validated JSON formatting document alongside the canonical narrative strings. Draft saving/reopening, signing review and longitudinal note history preserve formatting. Existing plain-text notes remain editable; older clients retain formatting for unchanged narratives and clear it when replacing their text. Template/context appends preserve existing formatting. Format-only edits participate in unsaved-change protection and revision checks.

The API accepts only supported document nodes and marks, enforces nesting/size limits and requires document text to match the saved narrative. Rendering uses React elements rather than raw HTML. Scripts, arbitrary attributes, links and embedded media are unsupported. Signed-note database immutability covers the new formatting column. No browser storage holds clinical drafts.

Verification: 15 focused PostgreSQL/HTTP tests and 11 frontend tests pass, alongside API/web type and lint checks. Chrome verifies toolbar actions, undo/redo, formatted draft persistence, review/signing, conflict/outage retention and mobile discard handling. Synthetic fixtures use disposable PostgreSQL on port 5437 only.

## Problem and diagnosis authoring

Open **Overview → Problems & diagnoses → Add problem or diagnosis**, or use the same action under **Problems & allergies**. A compact desktop side drawer/mobile bottom sheet displays the patient identity and eligible encounter. Select diagnosis or ongoing problem, record provisional/confirmed/differential verification status and enter the clinical description. Entries are explicitly uncoded; note assessment text is never converted automatically into a confirmed diagnosis or billing code.

**Mark resolved** is available on active local problems/diagnoses in the full record. The drawer loads the latest revision, requires a clinical reason and an active assigned encounter, and preserves the original description, author and encounter. The history displays recording author, verification status and resolution author/time/reason. External entries and allergy entries cannot be resolved by this workflow. Existing entries retain unknown verification status rather than being assumed confirmed. Reopening, correction/entered-in-error, verification revisions, terminology coding and allergy reconciliation remain pending.

Canonical staff routes require patient/entry read plus entry write and consultation capability for mutations. Outpatient writes require ownership of an in-consultation visit and matching encounter-specific care; inpatient/emergency writes require an active assigned encounter. Facility, organization, patient, encounter, ownership and care are checked server-side, with locks during mutation. Version checks reject competing resolutions. Actor-scoped command receipts prevent retry duplication; duplicate active descriptions of the same entry type require review. Audit/outbox/receipt metadata excludes descriptions and resolution narratives. Legacy staff entry mutation routes reject bypass attempts.

Migrations 0040–0041 add attribution, revision, resolution and verification fields. Local demo doctor/admin memberships receive entry write only; nurses retain entry read without diagnosis-authoring controls. No clinical records are added by enabling the capability.

Verification: six new PostgreSQL/HTTP integration tests cover scope/ownership, validation and attribution spoofing, concurrent retries, duplicates, unknown legacy verification, external-entry protection, competing resolution, retained original content, history, closure/revocation and legacy bypass. Combined note/history/entry tests: 21 passed. Frontend tests: 11 passed. API build, source type checks, lint and boundaries pass. Chrome verifies overview refresh, failed-save retention, desktop/mobile drawers, resolution, Escape discard protection and nursing action visibility with disposable 5437 fixtures cleaned afterward.

## Allergy recording and reconciliation

Open **Patient → Problems & allergies → Allergies & intolerances**. The dedicated record displays substance, reaction, allergy/intolerance type, category, reaction severity, future-reaction criticality, information source, verification, recording staff and timestamp. Legacy descriptions remain readable with missing details explicitly unrecorded. Desktop actions open a side drawer; mobile uses a bottom sheet. Inputs are in-memory only, failed requests retain entered information and unsaved changes require a discard decision.

**Add allergy** creates an authored uncoded entry with the selected encounter. Assigned nursing staff can record reported/unconfirmed information; clinician confirmation requires consultation capability. **Review allergy status** records unknown, no known allergies or no known drug allergies with information source, evidence/reason and explicit attestation. A negative declaration is rejected if inconsistent with active allergies; NKDA also rejects active legacy/unknown-category entries. Food/environment allergies can coexist with an explicit NKDA review. Review evidence is append-only and protected from update/delete by a database trigger.

**Correct erroneous entry** is restricted to treating clinicians with allergy correction capability and active local records. It preserves the substance, reaction, source and original author, with separate correction reason, actor, encounter and time. The history labels the entry entered in error rather than implying the allergy was cured. No correction automatically establishes a negative allergy status. External records require their source reconciliation workflow and cannot be corrected here.

Migration 0042 adds structured allergy details and review evidence. Read/write scope uses the selected organization/facility, patient care and matching active encounter. Outpatient care requires the assigned nurse in the nursing/consultation pathway or the treating clinician in consultation; inpatient/emergency requires explicit encounter care and clinical capability. Snapshot revisions, patient-scoped serialization, row locks and actor-scoped command receipts prevent stale/concurrent submissions and duplicate retries. Audit/outbox/receipt records exclude clinical narratives.

The sticky header now uses a dedicated complete active-allergy aggregate, independent of the bounded recent-entry page. It shows high-criticality text/color, explicit negative review status or unknown as appropriate. A new allergy supersedes an older negative declaration; a subsequent correction invalidates that declaration until reviewed again. The record retains the last review as historical evidence. Missing data never becomes NKA/NKDA.

Local demo nurse/doctor/admin accounts receive allergy recording capability; correction is enabled for demo doctor/admin only. Clinical assignment remains mandatory. Normal Docker schema updated without creating clinical records. Remaining scope includes terminology/allergen matching, structured onset/exposure and multiple reaction episodes, verification changes after initial recording, inactivation/refutation with governed history, shared/external reconciliation, prescribed-drug interaction checking and production clinical acceptance.

Verification: eight new PostgreSQL/HTTP tests cover nursing/treating-clinician scope, negative/unknown distinctions, immutable review evidence, concurrent retry/revision protection, contradiction/duplicate rejection, confirmation permissions, retained corrections, external and legacy records, complete header counts beyond the recent page, audit privacy and closure/revocation. Combined clinical tests: 29 passed; frontend tests: 11; API-client tests: 12, including safe conflict explanations. API build, source/client/contracts/web type checks, lint and boundaries pass. Chrome verifies negative review, structured capture, criticality/header refresh, failed-save and contradiction retention, preserved correction, mobile Escape/discard and nursing controls. Synthetic fixtures used disposable port 5437 and were cleaned afterward.
