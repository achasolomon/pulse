"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@pulse/ui";
import {
  ApiError,
  createStaffWebApi,
  type StaffPatientPage,
} from "@pulse/api-client";
const api = createStaffWebApi();
import { PatientRegistration } from "./patient-registration.js";
import { PatientCheckIn } from "./patient-check-in.js";
import { PatientDirectoryRecord } from "./patient-directory-record.js";
export function PatientWorklist({
  facilityId,
  privileges,
}: {
  facilityId: string;
  privileges: string[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState<StaffPatientPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>();
  const history = useRef<(string | undefined)[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError(null);
    setLoading(true);
    if (query.trim().length === 1) {
      setLoading(false);
      return () => controller.abort();
    }
    const timer = setTimeout(
      async () => {
        try {
          const result = await api.patients({
            query,
            status,
            cursor,
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setPage(result);
        } catch (err) {
          if (!controller.signal.aborted) {
            if (err instanceof ApiError && err.status === 401)
              window.location.assign("/login");
            else
              setError(
                err instanceof ApiError
                  ? err.message
                  : "Could not load patients. Please retry.",
              );
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      query ? 300 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, status, cursor, refresh, facilityId]);
  function reset() {
    history.current = [];
    setCursor(undefined);
  }
  return (
    <section className="patient-worklist" aria-label="Facility patients">
      <div className="patient-worklist__toolbar">
        {privileges.includes("patient:write") ? (
          <PatientRegistration
            onRegistered={(mrn) => {
              reset();
              setQuery(mrn);
              setRefresh((value) => value + 1);
            }}
          />
        ) : null}
        <label className="patient-search">
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="10"
              cy="10"
              r="6"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path d="m15 15 6 6" stroke="currentColor" strokeWidth="1.7" />
          </svg>
          <span className="sr-only">Search patients</span>
          <input
            type="search"
            placeholder="Search name or exact identifier"
            autoComplete="off"
            maxLength={100}
            value={query}
            onChange={(event) => {
              reset();
              setQuery(event.target.value);
            }}
          />
        </label>
        <div className="patient-worklist__filters" aria-label="Patient status">
          {[
            ["active", "Active"],
            ["all", "All records"],
            ["retired-duplicate", "Merged records"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={status === value}
              onClick={() => {
                reset();
                setStatus(value!);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="patient-worklist__message">
          <Alert tone="error">{error}</Alert>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p className="patient-worklist__message" role="status">
          Loading patients...
        </p>
      ) : null}
      {!loading && !error && query.trim().length === 1 ? (
        <p className="patient-worklist__message">
          Enter at least two characters to search.
        </p>
      ) : null}
      {page && !page.items.length ? (
        <div className="patient-worklist__empty">
          <span aria-hidden="true">⌕</span>
          <h2>{query ? "No matching patients" : "No patient records yet"}</h2>
          <p>
            {query
              ? "Try another name or an exact patient identifier."
              : "Patient records for this facility will appear here."}
          </p>
        </div>
      ) : null}
      {page?.items.length ? (
        <div className="patient-table-wrap">
          <table className="patient-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>MRN</th>
                <th>Date of birth</th>
                <th>Sex</th>
                <th>Record status</th>
                <th>
                  <span className="sr-only">Open patient</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((patient) => (
                <tr key={patient.id}>
                  <td>
                    {privileges.includes("observation:read") ||
                    privileges.includes("entry:read") ? (
                      <a
                        href={`/patients/${patient.id}`}
                        className="patient-name"
                      >
                        {patient.familyName}, {patient.givenName}
                      </a>
                    ) : (
                      <PatientDirectoryRecord patient={patient} />
                    )}
                    <span className="patient-name__meta">
                      MRN {patient.mrn ?? "not recorded"}
                      <br />
                      Born {patient.dateOfBirth}
                    </span>
                  </td>
                  <td>{patient.mrn ?? "Not recorded"}</td>
                  <td>{patient.dateOfBirth}</td>
                  <td>
                    {
                      { M: "Male", F: "Female", O: "Other", U: "Unknown" }[
                        patient.sex
                      ]
                    }
                  </td>
                  <td>
                    <span
                      className={`patient-record-status${patient.status === "retired-duplicate" ? " patient-record-status--merged" : ""}`}
                    >
                      {patient.status === "active" ? "Active" : "Merged record"}
                    </span>
                  </td>
                  <td>
                    {privileges.includes("observation:read") ||
                    privileges.includes("entry:read") ? (
                      <a
                        className="patient-open"
                        href={`/patients/${patient.id}`}
                        aria-label={`Open record for ${patient.givenName} ${patient.familyName}`}
                      >
                        Open <span aria-hidden="true">→</span>
                      </a>
                    ) : null}
                    {patient.status === "active" &&
                    privileges.includes("appointment:check-in") &&
                    privileges.includes("encounter:write") ? (
                      <PatientCheckIn patient={patient} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {page && (history.current.length > 0 || page.nextCursor) ? (
        <div className="patient-pagination">
          <span>{page.items.length} records on this page</span>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={!history.current.length || loading}
              onClick={() => setCursor(history.current.pop())}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!page.nextCursor || loading}
              onClick={() => {
                history.current.push(cursor);
                setCursor(page.nextCursor!);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
