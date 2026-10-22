"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button } from "@pulse/ui";
import {
  ApiError,
  createStaffWebApi,
  type StaffPatientIdentity,
  type PatientRegistrationInput,
} from "@pulse/api-client";
import { SettingsDrawer } from "./settings-drawer.js";
const api = createStaffWebApi();
export function PatientRegistration({
  onRegistered,
}: {
  onRegistered: (mrn: string) => void;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<StaffPatientIdentity[]>([]);
  const pending = useRef<Omit<PatientRegistrationInput, "commandKey"> | null>(
    null,
  );
  const command = useRef({ hash: "", key: "" });
  async function submit(input: Omit<PatientRegistrationInput, "commandKey">) {
    const hash = JSON.stringify(input);
    if (command.current.hash !== hash)
      command.current = { hash, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const result = await api.registerPatient({
        ...input,
        commandKey: command.current.key,
      });
      if (result.kind === "duplicate-review") {
        pending.current = input;
        setDuplicates(result.candidates);
      } else {
        setOpen(false);
        onRegistered(result.mrn);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Registration could not be saved. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit({
      givenName: String(data.get("givenName")).trim(),
      familyName: String(data.get("familyName")).trim(),
      dateOfBirth: String(data.get("dateOfBirth")),
      sex: String(data.get("sex")) as PatientRegistrationInput["sex"],
      ...(data.get("phone") ? { phone: String(data.get("phone")).trim() } : {}),
      ...(data.get("address")
        ? { address: String(data.get("address")).trim() }
        : {}),
    });
  }
  return (
    <>
      <Button
        disabled={!ready}
        onClick={() => {
          setDuplicates([]);
          setError(null);
          command.current = { hash: "", key: "" };
          setOpen(true);
        }}
      >
        Register patient
      </Button>
      {open ? (
        <SettingsDrawer
          id="patient-registration"
          title="Register patient"
          description="Create a record for this facility. An MRN is assigned automatically."
          busy={busy}
          onClose={() => setOpen(false)}
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          {duplicates.length ? (
            <div className="workflow-form">
              <Alert tone="warning">
                A patient with the same family name and date of birth already
                exists. Check the record before creating another.
              </Alert>
              {duplicates.map((p) => (
                <div className="workflow-identity" key={p.id}>
                  <strong>
                    {p.givenName} {p.familyName}
                  </strong>
                  <span>
                    MRN {p.mrn} · Born {p.dateOfBirth}
                  </span>
                  <button
                    type="button"
                    className="patient-open"
                    disabled={busy || !p.mrn}
                    onClick={() => {
                      if (p.mrn) {
                        setOpen(false);
                        onRegistered(p.mrn);
                      }
                    }}
                  >
                    Find existing record
                  </button>
                </div>
              ))}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setDuplicates([])}
              >
                Review details
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  if (pending.current)
                    void submit({ ...pending.current, confirmDuplicate: true });
                }}
              >
                {busy ? "Saving..." : "Register a separate patient"}
              </Button>
            </div>
          ) : (
            <form className="workflow-form" onSubmit={register}>
              <div className="workflow-fields">
                <label>
                  Given name
                  <input
                    name="givenName"
                    required
                    maxLength={100}
                    autoComplete="given-name"
                  />
                </label>
                <label>
                  Family name
                  <input
                    name="familyName"
                    required
                    maxLength={100}
                    autoComplete="family-name"
                  />
                </label>
              </div>
              <div className="workflow-fields">
                <label>
                  Date of birth
                  <input
                    name="dateOfBirth"
                    type="date"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </label>
                <label>
                  Sex
                  <select name="sex" required defaultValue="">
                    <option value="" disabled>
                      Select sex
                    </option>
                    <option value="F">Female</option>
                    <option value="M">Male</option>
                    <option value="O">Other</option>
                    <option value="U">Unknown</option>
                  </select>
                </label>
              </div>
              <label>
                Phone <small>(optional)</small>
                <input
                  name="phone"
                  type="tel"
                  maxLength={40}
                  autoComplete="tel"
                />
              </label>
              <label>
                Address <small>(optional)</small>
                <input
                  name="address"
                  maxLength={300}
                  autoComplete="street-address"
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? "Registering..." : "Create patient record"}
              </Button>
            </form>
          )}
        </SettingsDrawer>
      ) : null}
    </>
  );
}
