"use client";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  createStaffWebApi,
  type StaffPatientIdentity,
} from "@pulse/api-client";
const api = createStaffWebApi();
import { PatientDirectoryRecord } from "./patient-directory-record.js";

export function WorkspaceSearch({
  onChooseFacility,
  canSwitch,
  canSearchPatients = false,
  facilityId,
  canOpenCharts = false,
  canUseWorklists = false,
}: {
  onChooseFacility: () => void;
  canSwitch: boolean;
  canSearchPatients?: boolean;
  facilityId?: string;
  canOpenCharts?: boolean;
  canUseWorklists?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [patients, setPatients] = useState<StaffPatientIdentity[]>([]);
  const [patientError, setPatientError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedRecord, setSelectedRecord] =
    useState<StaffPatientIdentity | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPatients([]);
    setPatientError(null);
    setSearching(false);
    if (!canSearchPatients || !open || query.trim().length < 2)
      return () => controller.abort();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.patients({ query, signal: controller.signal });
        if (!controller.signal.aborted) setPatients(result.items.slice(0, 5));
      } catch (err) {
        if (!controller.signal.aborted)
          setPatientError(
            err instanceof ApiError
              ? err.message
              : "Patient search is unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, canSearchPatients, facilityId]);
  const pages = [
    ...(canUseWorklists
      ? [{ label: "Staff worklists", href: "/worklists" }]
      : []),
    ...(canSearchPatients ? [{ label: "Patients", href: "/patients" }] : []),
    { label: "Notifications", href: "/notifications" },
    { label: "Workspace", href: "/" },
    { label: "Account security", href: "/account/security" },
  ].filter((page) =>
    page.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const facilityMatch =
    canSwitch && "change facility".includes(query.trim().toLowerCase());
  return (
    <div
      ref={root}
      className="workspace-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          root.current?.querySelector("input")?.focus();
        }
        if (
          event.key === "ArrowDown" &&
          document.activeElement?.tagName === "INPUT"
        ) {
          event.preventDefault();
          root.current
            ?.querySelector<HTMLElement>(
              ".workspace-search__results a, .workspace-search__results button",
            )
            ?.focus();
        }
      }}
    >
      <div className="topbar__search">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="10.5"
            cy="10.5"
            r="6.5"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="m16 16 5 5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="search"
          aria-label="Search workspace"
          placeholder={
            canSearchPatients
              ? "Search patients or pages..."
              : "Search workspace..."
          }
          value={query}
          autoComplete="off"
          maxLength={100}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          aria-expanded={open}
          aria-controls="workspace-search-results"
        />
      </div>
      {open ? (
        <div
          id="workspace-search-results"
          className="workspace-search__results"
        >
          <span className="workspace-search__caption">Pages & actions</span>
          {pages.map((page) => (
            <a key={page.href} href={page.href}>
              {page.label}
              <span aria-hidden="true">↗</span>
            </a>
          ))}
          {facilityMatch ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onChooseFacility();
              }}
            >
              Change facility<span aria-hidden="true">↗</span>
            </button>
          ) : null}
          {!pages.length && !facilityMatch ? (
            <p>No matching pages or actions.</p>
          ) : null}
          {canSearchPatients && query.trim().length >= 2 ? (
            <div className="workspace-search__patients">
              <span className="workspace-search__caption">
                Patients in this facility
              </span>
              {searching ? (
                <p role="status">Searching patients...</p>
              ) : patientError ? (
                <p role="alert">{patientError}</p>
              ) : patients.length ? (
                patients.map((patient) =>
                  canOpenCharts ? (
                    <a key={patient.id} href={`/patients/${patient.id}`}>
                      <span>
                        <strong>
                          {patient.familyName}, {patient.givenName}
                        </strong>
                        <small>
                          MRN {patient.mrn ?? "not recorded"} · Born{" "}
                          {patient.dateOfBirth}
                        </small>
                      </span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      key={patient.id}
                      onClick={() => {
                        setOpen(false);
                        setSelectedRecord(patient);
                      }}
                    >
                      <span>
                        <strong>
                          {patient.familyName}, {patient.givenName}
                        </strong>
                        <small>
                          MRN {patient.mrn ?? "not recorded"} · Born{" "}
                          {patient.dateOfBirth}
                        </small>
                      </span>
                    </button>
                  ),
                )
              ) : (
                <p>No matching patients.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {selectedRecord ? (
        <PatientDirectoryRecord
          patient={selectedRecord}
          initialOpen
          onClose={() => setSelectedRecord(null)}
        />
      ) : null}
    </div>
  );
}
