"use client";
import Link from "next/link";
import {loadCriticalCounts} from '../lib/critical-counts.js';
import { CriticalBackupRouting } from "./critical-backup-routing.js";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@pulse/ui";
import { ApiError, createStaffWebApi } from "@pulse/api-client";
import { SettingsDrawer } from "./settings-drawer.js";
import {canUseCriticalResults as allowed} from '../lib/workspace-navigation.mjs';
const api = createStaffWebApi();
type Detail = Awaited<ReturnType<typeof api.criticalDetail>>;
type CriticalCase = NonNullable<Detail["case"]>;
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 23);
};
export function CriticalIndicator({
  facilityId,
  privileges,
}: {
  facilityId: string;
  privileges: string[];
}) {
  const [counts, setCounts] = useState<{
      pending: number;
      overdue: number;
    } | null>(null),
    [failed, setFailed] = useState(false);
  const enabled = allowed(privileges);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    let running = false;
    async function load() {
      if (document.hidden || running) return;
      running = true;
      try {
        const r = await loadCriticalCounts(privileges,c.signal);
        if (!c.signal.aborted) {
          setCounts(r);
          setFailed(false);
        }
      } catch {
        if (!c.signal.aborted) setFailed(true);
      } finally {
        running = false;
      }
    }
    void load();
    const t = setInterval(() => void load(), 15000);
    window.addEventListener("focus", load);
    return () => {
      c.abort();
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [facilityId, enabled]);
  if (!enabled) return null;
  return (
    <Link
      className={`critical-indicator${counts?.pending ? " critical-indicator--pending" : ""}`}
      href="/critical-results"
      aria-label={
        failed
          ? "Critical follow-up unavailable"
          : `Critical follow-up: ${counts?.pending ?? "loading"} pending`
      }
      title={
        failed
          ? "Critical follow-up could not refresh. Open the worklist."
          : `${counts?.overdue ?? 0} past follow-up time`
      }
    >
      <span aria-hidden="true">!</span>
      <span>Critical follow-up</span>
      <strong>{failed ? "?" : (counts?.pending ?? "…")}</strong>
    </Link>
  );
}
export function CriticalFollowup({
  orderId,
  orderVersion,
  privileges,
  onDirty,
  onBusy,
  onReady,
  onPinned,
  showResults = true,
}: {
  orderId: string;
  orderVersion?: number;
  privileges: string[];
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
  onReady?: (v: boolean) => void;
  onPinned?: (v: boolean) => void;
  showResults?: boolean;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [recipients, setRecipients] = useState<{ id: string; label: string }[]>([]),
    [recipient, setRecipient] = useState(""),
    [due, setDue] = useState(""),
    [channel, setChannel] = useState<"phone" | "in-person">("phone"),
    [outcome, setOutcome] = useState<"reached" | "unreachable">("unreachable"),
    [time, setTime] = useState(localNow),
    [readBack, setReadBack] = useState(false),
    [attested, setAttested] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState<string | null>(null);
  const [backupDirty, setBackupDirty] = useState(false),
    [backupBusy, setBackupBusy] = useState(false),
    [contactRecipient, setContactRecipient] = useState("");
  useEffect(() => onDirty(dirty || backupDirty), [dirty, backupDirty, onDirty]);
  useEffect(() => onBusy(busy || backupBusy), [busy, backupBusy, onBusy]);
  const command = useRef({ hash: "", key: "" }),
    dirtyRef = useRef(dirty);
  dirtyRef.current = dirty || backupDirty;
  const verifier =
    privileges.includes("lab:verify") && privileges.includes("lab:worklist");
  useEffect(() => {
    const c = new AbortController();
    let running = false;
    async function load() {
      if (running) return;
      running = true;
      try {
        const d = await api.criticalDetail(orderId, c.signal);
        if (!c.signal.aborted) {
          setDetail(d);
          onReady?.(Boolean(d.case?.acknowledgedAt));
          onPinned?.(Boolean(d.case));
          setError(null);
        }
        if (verifier && !d.case) {
          const r = await api.criticalRecipients(orderId, c.signal);
          if (!c.signal.aborted) setRecipients(r);
        }
      } catch (e) {
        if (!c.signal.aborted) {
          onReady?.(false);
          setError(
            e instanceof ApiError
              ? e.message
              : "Could not load critical follow-up.",
          );
        }
      } finally {
        running = false;
      }
    }
    void load();
    const t = setInterval(() => {
      if (!dirtyRef.current && !document.hidden) void load();
    }, 15000);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, [orderId, verifier, revision, onReady, onPinned]);
  function changed() {
    setDirty(true);

    setMessage(null);
  }
  async function submit(kind: "notify" | "attempt" | "acknowledge") {
    if (!detail || backupBusy) return;
    const c = detail.case;
    const payload =
      kind === "notify"
        ? {
            expectedVersion: orderVersion!,
            recipientId: recipient,
            dueAt: new Date(due).toISOString(),
            attestation: true as const,
          }
        : kind === "attempt"
          ? {
              expectedVersion: c!.version,
              recipientId: contactRecipient || c!.recipientId,
              channel,
              outcome,
              readBack,
              occurredAt: new Date(time).toISOString(),
            }
          : { expectedVersion: c!.version, attestation: true as const };
    const hash = JSON.stringify({ kind, ...payload });
    if (hash !== command.current.hash)
      command.current = { hash, key: crypto.randomUUID() };
    setBusy(true);

    setError(null);
    try {
      const d =
        kind === "notify"
          ? await api.notifyCritical(orderId, {
              expectedVersion: orderVersion!,
              recipientId: recipient,
              dueAt: new Date(due).toISOString(),
              attestation: true,
              commandKey: command.current.key,
            })
          : kind === "attempt"
            ? await api.contactCritical(orderId, {
                expectedVersion: c!.version,
                recipientId: contactRecipient || c!.recipientId,
                channel,
                outcome,
                readBack,
                occurredAt: new Date(time).toISOString(),
                commandKey: command.current.key,
              })
            : await api.acknowledgeCritical(orderId, {
                expectedVersion: c!.version,
                attestation: true,
                commandKey: command.current.key,
              });
      setDetail(d);
      onReady?.(Boolean(d.case?.acknowledgedAt));
      setDirty(false);

      setAttested(false);
      setReadBack(false);
      setOutcome("unreachable");
      setTime(localNow());
      setMessage(
        kind === "notify"
          ? "Critical follow-up assigned. Direct contact is still required."
          : kind === "attempt"
            ? "Contact evidence saved. This does not acknowledge the finding."
            : "Acknowledgement recorded. Laboratory final verification remains a separate action.",
      );
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not save. Your entered information is kept.",
      );
    } finally {
      setBusy(false);
      onBusy(backupBusy);
    }
  }
  const c = detail?.case;
  return (
    <section
      className="critical-followup"
      aria-label="Critical result communication"
    >
      <div className="lab-results__heading">
        <h3>Critical communication</h3>
        <span
          className={`clinical-summary__pill clinical-summary__pill--${c?.acknowledgedAt ? "neutral" : "critical"}`}
        >
          {c?.acknowledgedAt
            ? "Acknowledged"
            : c
              ? "Awaiting acknowledgement"
              : "Release held"}
        </span>
      </div>
      {error ? (
        <Alert tone="error">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>
            Refresh follow-up
          </button>
        </Alert>
      ) : null}
      {message ? (
        <p role="status" className="note-save-message">
          {message}
        </p>
      ) : null}
      {!detail && !error ? (
        <p role="status">Loading critical follow-up…</p>
      ) : null}
      {detail && !c ? (
        <>
          <p className="workflow-hint">
            A separate verifier must confirm this finding and name a clinician
            with current care responsibility. Use the facility’s direct
            escalation procedure; in-app delivery alone is insufficient.
          </p>
          {verifier ? (
            <div className="workflow-form problem-entry-form">
              <label>
                Responsible clinician
                <select
                  name="criticalRecipient"
                  value={recipient}
                  disabled={busy || backupBusy}
                  onChange={(e) => {
                    changed();
                    setRecipient(e.target.value);
                  }}
                >
                  <option value="">Select an authorised clinician</option>
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              {!recipients.length ? (
                <Alert tone="warning">
                  No eligible clinician is available. Follow the facility
                  escalation procedure; access and care responsibility must be
                  reconciled before electronic assignment.
                </Alert>
              ) : null}
              <label>
                Follow up by
                <input
                  name="criticalDueAt"
                  type="datetime-local" step="1"
                  value={due}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setDue(e.target.value);
                  }}
                />
                <small>
                  Choose according to facility policy. A configured backup can
                  activate at this deadline.
                </small>
              </label>
              <label className="lab-order-attestation">
                <input
                  name="criticalConfirmation"
                  type="checkbox"
                  checked={attested}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setAttested(e.target.checked);
                  }}
                />
                <span>
                  I independently confirmed the critical finding and checked the
                  patient, specimen, result and responsible clinician. These
                  components will be locked for communication.
                </span>
              </label>
              <Button
                disabled={
                  busy ||
                  backupBusy ||
                  !recipient ||
                  !due ||
                  !Number.isFinite(Date.parse(due)) ||
                  !attested ||
                  !orderVersion
                }
                onClick={() => void submit("notify")}
              >
                Confirm & assign follow-up
              </Button>
            </div>
          ) : (
            <p className="workflow-hint">
              An authorised laboratory verifier must confirm and assign this
              finding.
            </p>
          )}
        </>
      ) : null}
      {detail && showResults ? (
        <>
          <p className="workflow-hint">
            Confirmed critical findings for communication; final report release
            is a separate step.
          </p>
          <ul className="lab-results__list">
            {detail.results.map((r) => (
              <li key={r.id}>
                <strong>{r.component}</strong>
                <span
                  className={`clinical-summary__pill clinical-summary__pill--${r.flag === "critical" ? "critical" : "neutral"}`}
                >
                  {r.flag ?? "Not interpreted"}
                </span>
                <p className="lab-results__value">
                  {r.value} {r.unit}
                </p>
                <small>
                  Measured{" "}
                  {r.effectiveAt
                    ? new Date(r.effectiveAt).toLocaleString()
                    : "Not recorded"}{" "}
                  · Revision {r.version}
                </small>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {c ? (
        <>
          <dl className="record-field-list">
            <div>
              <dt>Original clinician</dt>
              <dd>{c.recipientLabel ?? "Named staff member"}</dd>
            </div>
            <div>
              <dt>Follow up by</dt>
              <dd>
                {new Date(c.dueAt).toLocaleString()}
                {!c.acknowledgedAt && Date.parse(c.dueAt) < Date.now() ? (
                  <strong className="critical-overdue">
                    Past follow-up time — escalate directly
                  </strong>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Confirmed by</dt>
              <dd>
                {c.confirmedByLabel ?? "Laboratory verifier"} ·{" "}
                {new Date(c.createdAt).toLocaleString()}
              </dd>
            </div>
          </dl>
          <CriticalBackupRouting
            orderId={orderId}
            detail={detail}
            canConfigure={verifier}
            externalBusy={busy}
            onSaved={setDetail}
            onDirty={v=>{setBackupDirty(v);onDirty(v||dirty);}}
            onBusy={v=>{setBackupBusy(v);onBusy(v||busy);}}
          />
          <h4>Contact attempts</h4>
          {detail.contacts.length ? (
            <ul className="lab-results__list">
              {detail.contacts.map((a) => (
                <li key={a.id}>
                  <strong>
                    {a.outcome === "reached"
                      ? "Reached · Read-back confirmed"
                      : "Unreachable"}
                  </strong>
                  <small>
                    {a.channel} · {new Date(a.occurredAt).toLocaleString()}
                  </small>
                  <small>
                    Recipient: {a.recipientLabel ?? "Named clinician"}
                  </small>
                  <small>{a.actorLabel ?? "Laboratory staff"}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workflow-hint">
              No direct contact recorded. An in-app notification is not
              acknowledgement.
            </p>
          )}
          {c.acknowledgedAt ? (
            <Alert tone="info">
              Acknowledged {new Date(c.acknowledgedAt).toLocaleString()}. This
              records receipt and responsibility; it does not complete clinical
              treatment or replace final laboratory verification.
            </Alert>
          ) : detail.canAcknowledge ? (
            <div className="workflow-form">
              <label className="lab-order-attestation">
                <input
                  name="criticalAcknowledgement"
                  type="checkbox"
                  checked={attested}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setAttested(e.target.checked);
                  }}
                />
                <span>
                  I received and reviewed this confirmed critical finding and
                  accept responsibility for timely clinical assessment and
                  follow-up.
                </span>
              </label>
              <p className="workflow-hint">
                Opening this screen does not acknowledge the finding. Laboratory
                communication and read-back must be recorded first.
              </p>
              <Button
                disabled={busy || !attested || !detail.readBackConfirmed}
                onClick={() => void submit("acknowledge")}
              >
                Acknowledge critical finding
              </Button>
            </div>
          ) : verifier ? (
            <div className="workflow-form problem-entry-form">
              <h4>Record contact with the named clinician</h4>
              <label>
                Contact recipient
                <select
                  name="criticalContactRecipient"
                  value={contactRecipient || c.recipientId}
                  disabled={busy || backupBusy}
                  onChange={(e) => {
                    changed();
                    setContactRecipient(e.target.value);
                    setReadBack(false);
                  }}
                >
                  <option value={c.recipientId}>
                    {c.recipientLabel ?? "Original clinician"}
                  </option>
                  {detail.backups
                    .filter((b) => b.status === "active")
                    .map((b) => (
                      <option key={b.id} value={b.recipientId}>
                        {b.recipientLabel ?? "Covering clinician"}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Channel
                <select
                  name="criticalChannel"
                  value={channel}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setChannel(e.target.value as typeof channel);
                  }}
                >
                  <option value="phone">Phone</option>
                  <option value="in-person">In person</option>
                </select>
              </label>
              <label>
                Outcome
                <select
                  name="criticalOutcome"
                  value={outcome}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setOutcome(e.target.value as typeof outcome);
                    setReadBack(false);
                  }}
                >
                  <option value="unreachable">Unreachable</option>
                  <option value="reached">Reached</option>
                </select>
              </label>
              <label>
                Actual contact time
                <input
                  name="criticalContactTime"
                  type="datetime-local"
                  step="0.001"
                  value={time}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setTime(e.target.value);
                  }}
                />
              </label>
              {outcome === "reached" ? (
                <label className="lab-order-attestation">
                  <input
                    name="criticalReadBack"
                    type="checkbox"
                    checked={readBack}
                    disabled={busy}
                    onChange={(e) => {
                      changed();
                      setReadBack(e.target.checked);
                    }}
                  />
                  <span>
                    I spoke with the named clinician, communicated the patient
                    and critical finding, and confirmed read-back.
                  </span>
                </label>
              ) : (
                <p className="workflow-hint">
                  The case stays unresolved. Follow the facility escalation
                  procedure and continue contact attempts.
                </p>
              )}
              <Button
                disabled={
                  busy ||
                  !time ||
                  !Number.isFinite(Date.parse(time)) ||
                  (outcome === "reached" && !readBack)
                }
                onClick={() => void submit("attempt")}
              >
                Save contact attempt
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
export function CriticalWorkspace({
  facilityId,
  privileges,
}: {
  facilityId: string;
  privileges: string[];
}) {
  const [items, setItems] = useState<CriticalCase[]>([]),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [cursor, setCursor] = useState<string | undefined>(),
    [next, setNext] = useState<string | null>(null),
    [selected, setSelected] = useState<CriticalCase | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    let running = false;
    async function load() {
      if (running || document.hidden) return;
      running = true;
      try {
        const r = await api.criticalQueue(cursor, c.signal);
        if (!c.signal.aborted) {
          setItems(r.items);
          setNext(r.nextCursor);
          setError(null);
        }
      } catch (e) {
        if (!c.signal.aborted)
          setError(
            e instanceof ApiError
              ? e.message
              : "Critical worklist is unavailable.",
          );
      } finally {
        running = false;
        if (!c.signal.aborted) setLoading(false);
      }
    }
    setLoading(true);
    void load();
    const t = setInterval(() => {
      if (!selected) void load();
    }, 15000);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, [facilityId, cursor, selected, revision]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function close() {
    setSelected(null);
    setDirty(false);
    setDiscard(false);
    setRevision((n) => n + 1);
  }
  return (
    <section>
      <Alert tone="warning">
        Critical findings require direct communication and explicit
        acknowledgement. Follow-up deadlines remain visible after encounter
        closure. Configured backups activate at the follow-up deadline. Check blocked activations and continue the facility’s direct escalation procedure. External messages are not sent by this workflow.
      </Alert>
      {error ? (
        <Alert tone="error">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>
            Retry worklist
          </button>
        </Alert>
      ) : null}
      {loading ? (
        <p role="status">Loading pending critical findings…</p>
      ) : !items.length && !error ? (
        <p>No pending critical findings in your authorised worklist.</p>
      ) : null}
      <ul className="lab-queue__list">
        {items.map((c) => (
          <li key={c.orderId}>
            <article className="critical-worklist-row">
              <div>
                <strong>{c.patient.name}</strong>
                <small>MRN {c.patient.mrn ?? "Not recorded"}</small>
                <span>{c.testName}</span>
              </div>
              <div>
                <strong>{c.recipientLabel ?? "Original clinician"}</strong>
                {c.coveringLabels?.map((label, i) => (
                  <small key={i}>Cover: {label}</small>
                ))}
                <small>Follow up {new Date(c.dueAt).toLocaleString()}</small>
                {Date.parse(c.dueAt) < Date.now() ? (
                  <span className="clinical-summary__pill clinical-summary__pill--critical">
                    Past follow-up time
                  </span>
                ) : (
                  <span className="clinical-summary__pill clinical-summary__pill--warning">
                    Awaiting acknowledgement
                  </span>
                )}
              </div>
              <Button variant="secondary" onClick={() => setSelected(c)}>
                Review critical finding
              </Button>
            </article>
          </li>
        ))}
      </ul>
      <div className="lab-queue__pagination">
        {cursor ? (
          <Button variant="secondary" onClick={() => setCursor(undefined)}>
            First page
          </Button>
        ) : null}
        <Button
          variant="secondary"
          disabled={!next}
          onClick={() => setCursor(next!)}
        >
          Next page
        </Button>
      </div>
      {selected ? (
        <SettingsDrawer
          id="critical-result-drawer"
          title="Critical finding"
          description="Confirmed laboratory communication · final report release is a separate step"
          busy={busy}
          onClose={close}
          onBeforeClose={() => {
            if (dirty) {
              setDiscard(true);
              return false;
            }
            return true;
          }}
        >
          {discard ? (
            <div role="alert" className="note-discard-warning">
              <strong>Discard unsaved acknowledgement?</strong>
              <Button variant="secondary" onClick={() => setDiscard(false)}>
                Keep editing
              </Button>
              <Button onClick={close}>Discard changes</Button>
            </div>
          ) : null}
          <div className="note-patient-context">
            <div>
            <strong>{selected.patient.name}</strong>
            <small>
              MRN {selected.patient.mrn ?? "Not recorded"} · {selected.testName}
            </small>
            </div>
          </div>
          <CriticalFollowup
            orderId={selected.orderId}
            privileges={privileges}
            onDirty={setDirty}
            onBusy={setBusy}
          />
        </SettingsDrawer>
      ) : null}
    </section>
  );
}
