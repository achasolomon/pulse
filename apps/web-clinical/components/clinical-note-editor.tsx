"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@pulse/ui";
import {
  ApiError,
  createStaffWebApi,
  type StaffClinicalNote,
  type StaffNoteContent,
  type StaffNoteDraftContent,
  type StaffNoteContext,
} from "@pulse/api-client";
import { SettingsDrawer } from "./settings-drawer.js";
import { NoteWorkspace, type NoteSection } from "./note-workspace.js";
import { RichNoteView } from "./rich-note-editor.js";
const api = createStaffWebApi();
const empty: StaffNoteContent = {
  chiefComplaint: "",
  history: "",
  examination: "",
  assessment: "",
  plan: "",
};
const fields: { key: keyof StaffNoteContent; label: string; limit: number }[] =
  [
    {
      key: "chiefComplaint",
      label: "Reason for note / chief complaint",
      limit: 2000,
    },
    { key: "history", label: "History / nursing observations", limit: 10000 },
    {
      key: "examination",
      label: "Examination / assessment findings",
      limit: 10000,
    },
    { key: "assessment", label: "Clinical assessment", limit: 10000 },
    { key: "plan", label: "Care plan / follow-up", limit: 10000 },
  ];
function content(note: StaffNoteDraftContent): StaffNoteDraftContent {
  return {
    chiefComplaint: note.chiefComplaint,
    history: note.history,
    examination: note.examination,
    assessment: note.assessment,
    plan: note.plan,
    ...(note.richText && Object.keys(note.richText).length ? {richText: note.richText} : {}),
  };
}
export function ClinicalNoteEditor({
  patientId,
  patientName,
  mrn,
  dateOfBirth,
  noteId,
  amend = false,
  privileges,
  onClose,
  onSaved,
}: {
  patientId: string;
  patientName: string;
  mrn: string | null;
  dateOfBirth: string;
  noteId?: string;
  amend?: boolean;
  privileges: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState<StaffClinicalNote | null>(null),
    [values, setValues] = useState<StaffNoteDraftContent>(empty),
    [saved, setSaved] = useState(JSON.stringify(empty));
  const [contexts, setContexts] = useState<StaffNoteContext[] | null>(null),
    [encounterId, setEncounterId] = useState(""),
    [kind, setKind] = useState<"consultation" | "nursing">("consultation");
  const [mode, setMode] = useState<"edit" | "review" | "amend">(
      amend ? "amend" : "edit",
    ),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [discard, setDiscard] = useState(false),
    [attestation, setAttestation] = useState(false),
    [addendum, setAddendum] = useState("");
  const [activeSection, setActiveSection] = useState<NoteSection>("subjective");
  const command = useRef({ hash: "", key: "" });
  const dirty = amend ? !!addendum.trim() : JSON.stringify(values) !== saved;
  useEffect(() => {
    if (discard)
      document
        .querySelector<HTMLButtonElement>(".note-discard-warning button")
        ?.focus();
  }, [discard]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        if (noteId) {
          const current = await api.clinicalNote(noteId, controller.signal);
          if (current.patientId !== patientId)
            throw new Error("The note belongs to another patient");
          if (controller.signal.aborted) return;
          setNote(current);
          setValues(content(current));
          setSaved(JSON.stringify(content(current)));
          if (current.status === "signed" && !amend) setMode("review");
          setEncounterId(current.encounterId);
          if (current.kind !== "clinical") setKind(current.kind);
        } else {
          const available = await api.noteContexts(
            patientId,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setContexts(available);
          if (available.length === 1) {
            setEncounterId(available[0].encounterId);
            setKind(available[0].kinds[0]!);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(
            err instanceof ApiError
              ? err.message
              : "This note could not be loaded. Close and try again.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [patientId, noteId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function key(input: unknown) {
    const hash = JSON.stringify(input);
    if (command.current.hash !== hash)
      command.current = { hash, key: crypto.randomUUID() };
    return command.current.key;
  }
  function requestClose() {
    if (dirty) {
      setDiscard(true);
      return false;
    }
    return true;
  }
  function accept(current: StaffClinicalNote) {
    setNote(current);
    setValues(content(current));
    setSaved(JSON.stringify(content(current)));
    onSaved();
  }
  async function save(review = false) {
    if(JSON.stringify(values.richText??{}).length>60000){setError('The note exceeds its formatting limit. Reduce formatting or shorten a section before saving. Your text is still here.');return;}
    if(review&&![values.history,values.examination,values.assessment,values.plan].some(value=>value.trim())){setError('Add clinical content before reviewing and signing. You can still save a draft.');return;}
    if (!values.chiefComplaint.trim()) {
      setActiveSection("subjective");
      setError("Enter a reason for this note before saving.");
      return;
    }
    if (!encounterId) {
      setError("Select an active assigned encounter.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let current = note;
      if (!current || dirty) {
        const input = { ...values };
        current = current
          ? await api.saveClinicalNote(current.id, {
              ...input,
              expectedVersion: current.version,
              commandKey: key({
                action: "save",
                id: current.id,
                version: current.version,
                ...input,
              }),
            })
          : await api.createClinicalNote(patientId, {
              ...input,
              encounterId,
              kind,
              commandKey: key({
                action: "create",
                encounterId,
                kind,
                ...input,
              }),
            });
        accept(current);
      }
      setMessage("Draft saved. It has not been signed.");
      if (review) {
        setAttestation(false);
        setMode("review");
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not save this draft. Your text is still here; please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function sign() {
    if (!note || !attestation) return;
    setBusy(true);
    setError(null);
    try {
      await api.signClinicalNote(note.id, {
        expectedVersion: note.version,
        attestation: true,
        commandKey: key({ action: "sign", id: note.id, version: note.version }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not sign this note. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function append() {
    if (!note || addendum.trim().length < 3) {
      setError("Enter at least three characters for the addendum.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.amendClinicalNote(note.id, {
        text: addendum,
        commandKey: key({ action: "amend", id: note.id, text: addendum }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not append the addendum. Your text is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  const available = contexts?.find((c) => c.encounterId === encounterId);
  return (
    <SettingsDrawer
      id="clinical-note-editor"
      className="clinical-note-drawer"
      title={
        amend
          ? "Add an addendum"
          : mode === "review"
            ? "Review & sign note"
            : note
              ? "Edit draft note"
              : "New clinical note"
      }
      description={
        amend
          ? "Add a dated, attributed correction without replacing the signed note."
          : "Document care for the correct patient and encounter. Drafts remain private to their author."
      }
      busy={busy}
      onBeforeClose={requestClose}
      onClose={onClose}
      footerActions={
        !loading && (!error || note || contexts?.length) ? (
          <div className="note-editor-actions">
            {amend ? (
              <Button
                disabled={busy || !note || !addendum.trim()}
                onClick={() => void append()}
              >
                {busy ? "Saving..." : "Append addendum"}
              </Button>
            ) : mode === "review" ? (
              <>
                <Button
                  variant="secondary"
                  disabled={busy || note?.status === "signed"}
                  onClick={() => setMode("edit")}
                >
                  Back to draft
                </Button>
                <Button
                  disabled={
                    busy ||
                    !attestation ||
                    !privileges.includes("note:sign") ||
                    note?.status !== "draft"
                  }
                  onClick={() => void sign()}
                >
                  {busy ? "Signing..." : "Sign note"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  disabled={busy || (!note && !contexts?.length)}
                  onClick={() => void save()}
                >
                  {busy ? "Saving..." : "Save draft"}
                </Button>
                {privileges.includes("note:sign") ? (
                  <Button
                    disabled={busy || (!note && !contexts?.length)}
                    onClick={() => void save(true)}
                  >
                    Review & sign
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ) : null
      }
    >
      <div className="workflow-identity">
        <strong>{patientName}</strong>
        <span>
          MRN {mrn ?? "Not recorded"} · Born {dateOfBirth}
        </span>
        <span>
          {note
            ? `${note.kind} note · ${note.status} · Revision ${note.version}`
            : "New note"}
        </span>
      </div>
      <div className="note-draft-status"><span className={dirty ? "note-draft-status__unsaved" : ""}>{note?.status === "signed" ? "Signed record" : dirty ? "Unsaved changes" : note ? "Draft saved" : "Not yet saved"}</span><small>{note?.updatedAt ? "Last saved " + new Date(note.updatedAt).toLocaleString() : "Save a draft to keep your work"}</small></div>
      {loading ? <p role="status">Loading note workspace...</p> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {message ? (
        <p role="status" className="note-save-message">
          {message}
        </p>
      ) : null}
      {discard ? (
        <div className="note-discard-warning" role="alert">
          <strong>Discard unsaved changes?</strong>
          <p>
            Your last saved draft is kept. Text entered since then will be lost.
          </p>
          <div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDiscard(false)}
            >
              Keep editing
            </Button>
            <Button disabled={busy} onClick={onClose}>
              Discard changes
            </Button>
          </div>
        </div>
      ) : null}
      {!loading && !note && !contexts?.length ? (
        <Alert tone="info">
          No active assigned encounter is available. Claim the nursing visit or
          start your assigned consultation from Staff worklists, then return to
          document care.
        </Alert>
      ) : null}
      {!loading && (note || !!contexts?.length) ? (
        <>
          {!note ? (
            <div className="workflow-form note-context-fields">
              <label>
                Encounter
                <select
                  value={encounterId}
                  disabled={busy}
                  onChange={(e) => {
                    setEncounterId(e.target.value);
                    const selected = contexts?.find(
                      (c) => c.encounterId === e.target.value,
                    );
                    if (selected) setKind(selected.kinds[0]!);
                  }}
                  required
                >
                  <option value="" disabled>
                    Select an assigned encounter
                  </option>
                  {contexts?.map((c) => (
                    <option key={c.encounterId} value={c.encounterId}>
                      {c.type} · {new Date(c.startedAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note type
                <select
                  value={kind}
                  disabled={busy || !available}
                  onChange={(e) =>
                    setKind(e.target.value as "consultation" | "nursing")
                  }
                >
                  {(available?.kinds ?? [kind]).map((k) => (
                    <option key={k} value={k}>
                      {k === "nursing" ? "Nursing note" : "Consultation note"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <p className="note-encounter-context">
              {note.encounter
                ? `${note.encounter.type} encounter · ${new Date(note.encounter.startedAt).toLocaleString()} · ${note.encounter.status}`
                : "Linked to the encounter selected when this note was created."}
            </p>
          )}
          {mode === "edit" ? (
            <NoteWorkspace patientId={patientId} privileges={privileges} kind={kind} values={values} busy={busy} section={activeSection} onSectionChange={setActiveSection} onChange={(next) => { setValues(next); setMessage(null); }} />
          ) : (
            <div className="note-review">
              <div className="note-review-heading">
                <span className="record-status">
                  {note?.status === "signed"
                    ? "Signed note"
                    : "Draft for review"}
                </span>
                {note?.signedAt ? (
                  <time>{new Date(note.signedAt).toLocaleString()}</time>
                ) : null}
              </div>
              {fields.map((field) => (
                <section key={field.key}>
                  <h3>{field.label}</h3>
                  {field.key !== "chiefComplaint" && values.richText?.[field.key] ? <RichNoteView document={values.richText[field.key]!} /> : <p>{values[field.key] || "Not recorded"}</p>}
                </section>
              ))}
              {note?.addenda.map((a) => (
                <section key={a.id}>
                  <h3>Addendum · {new Date(a.createdAt).toLocaleString()}</h3>
                  <p>{a.text}</p>
                  <small>{a.authorLogin ?? "Author not recorded"}</small>
                </section>
              ))}
            </div>
          )}
          {mode === "review" ? (
            <>
              <Alert tone="warning">
                Signing makes this version immutable. Later corrections must be
                appended as addenda.
              </Alert>
              <label className="note-attestation">
                <input
                  type="checkbox"
                  checked={attestation}
                  disabled={busy}
                  onChange={(e) => setAttestation(e.target.checked)}
                />
                I have reviewed this note for the patient and encounter shown
                above.
              </label>
            </>
          ) : null}
          {amend ? (
            <div className="workflow-form">
              <label>
                Addendum
                <textarea
                  name="addendum"
                  rows={5}
                  maxLength={4000}
                  value={addendum}
                  disabled={busy}
                  onChange={(e) => setAddendum(e.target.value)}
                />
              </label>
              <p className="workflow-hint">
                Your identity and the submission time are recorded with this
                addendum.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </SettingsDrawer>
  );
}
