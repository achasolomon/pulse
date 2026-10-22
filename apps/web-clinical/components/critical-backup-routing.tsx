"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@pulse/ui";
import { ApiError, createStaffWebApi } from "@pulse/api-client";
const api = createStaffWebApi();
type Detail = Awaited<ReturnType<typeof api.criticalDetail>>;
export function CriticalBackupRouting({
  orderId,
  detail,
  canConfigure,
  externalBusy = false,
  onSaved,
  onDirty,
  onBusy,
}: {
  orderId: string;
  detail: Detail;
  canConfigure: boolean;
  externalBusy?: boolean;
  onSaved: (d: Detail) => void;
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
}) {
  const [candidates, setCandidates] = useState<{ id: string; label: string }[]>(
      [],
    ),
    [recipient, setRecipient] = useState(""),
    [mode, setMode] = useState<"immediate" | "at-deadline">("immediate"),
    [reason, setReason] = useState(""),
    [attested, setAttested] = useState(false),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const command = useRef({ hash: "", key: "" });
  const c = detail.case;
  useEffect(() => {
    if (!canConfigure || !c || c.acknowledgedAt) return;
    const a = new AbortController();
    api
      .criticalRecipients(orderId, a.signal)
      .then((r) => {
        if (!a.signal.aborted) setCandidates(r);
      })
      .catch((e) => {
        if (!a.signal.aborted)
          setError(
            e instanceof ApiError
              ? e.message
              : "Could not load covering clinicians.",
          );
      });
    return () => a.abort();
  }, [orderId, canConfigure, c?.acknowledgedAt, reload]);
  const options = candidates.filter(
    (r) =>
      r.id !== c?.recipientId &&
      !detail.backups.some((b) => b.recipientId === r.id),
  );
  const ready = Boolean(
    recipient &&
    reason.trim().length >= 5 &&
    attested &&
    c &&
    !c.acknowledgedAt,
  );
  function changed() {
    onDirty(true);
  }
  async function save() {
    if (!c || !ready || externalBusy) return;
    const input = {
      expectedVersion: c.version,
      recipientId: recipient,
      reason: reason.trim(),
      mode,
      attestation: true as const,
    };
    const hash = JSON.stringify(input);
    if (command.current.hash !== hash)
      command.current = { hash, key: crypto.randomUUID() };
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const d = await api.configureCriticalBackup(orderId, {
        ...input,
        commandKey: command.current.key,
      });
      onSaved(d);
      setRecipient("");
      setReason("");
      setAttested(false);
      setReview(false);
      onDirty(false);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not save routing. Your entered information is kept.",
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  if (!c) return null;
  return (
    <section className="critical-backup">
      <h4>Cover & escalation</h4>
      <p className="workflow-hint">
        The original assignment stays visible. Cover adds a named recipient
        while preserving communication history; it does not acknowledge the case
        or grant care access.
      </p>
      {error ? (
        <Alert tone="error">
          {error}
          <button onClick={() => setReload((n) => n + 1)}>
            Refresh eligible clinicians
          </button>
        </Alert>
      ) : null}
      {detail.backups.length ? (
        <ul className="lab-results__list">
          {detail.backups.map((b) => (
            <li key={b.id}>
              <strong>{b.recipientLabel ?? "Named covering clinician"}</strong>
              <span
                className={`clinical-summary__pill clinical-summary__pill--${b.status === "blocked" ? "critical" : b.status === "scheduled" ? "warning" : "neutral"}`}
              >
                {b.status === "blocked"
                  ? "Blocked — direct escalation required"
                  : b.status}
              </span>
              <small>
                {b.mode === "at-deadline"
                  ? "At follow-up deadline"
                  : "Immediate cover"}{" "}
                · {b.configuredByLabel ?? "Laboratory verifier"}
              </small>
              <p>{b.reason}</p>
              <small>
                {b.activatedAt
                  ? `Activated ${new Date(b.activatedAt).toLocaleString()}`
                  : b.status === "scheduled"
                    ? `Activates ${new Date(c.dueAt).toLocaleString()}`
                    : b.decision === "recipient-access-unavailable"
                      ? "Recipient membership, credentials or care access is unavailable. Choose another eligible clinician."
                      : b.decision === "case-acknowledged"
                        ? "Cancelled because the case was acknowledged."
                        : b.decision}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="workflow-hint">
          No backup has been configured. Follow the facility’s direct escalation
          procedure.
        </p>
      )}
      {canConfigure && !c.acknowledgedAt ? (
        <details>
          <summary>Add covering clinician</summary>
          <div className="workflow-form problem-entry-form">
            {review ? (
              <>
                <dl className="record-field-list">
                  <div>
                    <dt>Covering clinician</dt>
                    <dd>{candidates.find((r) => r.id === recipient)?.label}</dd>
                  </div>
                  <div>
                    <dt>Activation</dt>
                    <dd>
                      {mode === "immediate"
                        ? "Immediately"
                        : new Date(c.dueAt).toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>{reason}</dd>
                  </div>
                </dl>
                <div className="lab-results__actions">
                  <Button
                    variant="secondary"
                    disabled={busy || externalBusy}
                    onClick={() => setReview(false)}
                  >
                    Back to routing
                  </Button>
                  <Button disabled={busy} onClick={() => void save()}>
                    {busy ? "Saving…" : "Confirm covering clinician"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <label>
                  Covering clinician
                  <select
                    name="criticalBackupRecipient"
                    value={recipient}
                    disabled={busy}
                    onChange={(e) => {
                      changed();
                      setRecipient(e.target.value);
                    }}
                  >
                    <option value="">Select an eligible clinician</option>
                    {options.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!options.length ? (
                  <p className="workflow-hint">
                    No additional eligible clinician is available. Reconcile
                    care responsibility or use direct escalation; Pulse will not
                    grant access automatically.
                  </p>
                ) : null}
                <label>
                  Activation
                  <select
                    name="criticalBackupMode"
                    value={mode}
                    disabled={busy}
                    onChange={(e) => {
                      changed();
                      setMode(e.target.value as typeof mode);
                    }}
                  >
                    <option value="immediate">
                      Immediately — add cover now
                    </option>
                    <option
                      value="at-deadline"
                      disabled={Date.parse(c.dueAt) <= Date.now()}
                    >
                      At the existing follow-up deadline
                    </option>
                  </select>
                </label>
                <label>
                  Reason
                  <textarea
                    name="criticalBackupReason"
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    disabled={busy}
                    onChange={(e) => {
                      changed();
                      setReason(e.target.value);
                    }}
                  />
                </label>
                <label className="lab-order-attestation">
                  <input
                    name="criticalBackupAttestation"
                    type="checkbox"
                    checked={attested}
                    disabled={busy}
                    onChange={(e) => {
                      changed();
                      setAttested(e.target.checked);
                    }}
                  />
                  <span>
                    I checked this clinician’s covering responsibility and the
                    activation against facility policy. Direct communication and
                    read-back remain required for this recipient.
                  </span>
                </label>
                <Button
                  disabled={!ready || busy || externalBusy}
                  onClick={() => setReview(true)}
                >
                  Review covering clinician
                </Button>
              </>
            )}
          </div>
        </details>
      ) : null}
    </section>
  );
}
