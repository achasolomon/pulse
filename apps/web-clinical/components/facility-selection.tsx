"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@pulse/ui";
import { FacilityPicker } from "./facility-picker.js";
import { SignoutConfirmation } from "./signout-confirmation.js";
import { ApiError, createStaffWebApi } from "@pulse/api-client";
import type { PublicSession } from "../lib/session.js";
const api = createStaffWebApi();

export function FacilitySelection({ session }: { session: PublicSession }) {
  const [facilityId, setFacilityId] = useState(
    session.facility?.facilityId ?? "",
  );
  const [busy, setBusy] = useState<"select" | "logout" | null>(null);
  const [confirmSignout, setConfirmSignout] = useState(false);
  const [error, setError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const selected = session.facilities.find(
    (facility) => facility.facilityId === facilityId,
  );
  useEffect(() => {
    if (error) errorRegion.current?.focus();
  }, [error]);

  function failure(err: unknown, fallback: string) {
    setError({
      message: err instanceof ApiError ? err.message : fallback,
      ...(err instanceof ApiError && err.correlationId
        ? { correlationId: err.correlationId }
        : {}),
    });
  }
  async function select(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selected) return;
    setBusy("select");
    setError(null);
    try {
      await api.selectFacility(selected.facilityId);
      // Full navigation discards the previous facility's client state.
      window.location.assign("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign("/login");
        return;
      }
      failure(err, "Could not open your workspace. Please try again.");
    } finally {
      setBusy(null);
    }
  }
  async function signOut() {
    if (busy) return;
    setBusy("logout");
    setError(null);
    try {
      await api.logout();
      window.location.assign("/login");
    } catch (err) {
      failure(err, "Could not sign out. Please try again.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      {error ? (
        <div ref={errorRegion} tabIndex={-1} className="facility-error">
          <Alert tone="error">
            {error.message}
            {error.correlationId ? (
              <span className="auth-error__reference">
                Reference: {error.correlationId}
              </span>
            ) : null}
          </Alert>
        </div>
      ) : null}
      {session.facilities.length ? (
        <form method="post" className="facility-form" onSubmit={select}>
          <FacilityPicker
            id="facility"
            value={facilityId}
            disabled={busy !== null}
            onChange={(value) => {
              setFacilityId(value);
              setError(null);
            }}
            facilities={session.facilities}
          />
          <Button
            type="submit"
            className="facility-form__submit"
            loading={busy === "select"}
            disabled={busy !== null || !selected}
          >
            Open workspace
          </Button>
        </form>
      ) : (
        <Alert tone="warning" title="No active facility access">
          Contact your facility administrator to request access.
        </Alert>
      )}
      <div className="facility-card__bottom">
        <button
          type="button"
          className="auth-text-button"
          aria-busy={busy === "logout" || undefined}
          disabled={busy !== null}
          onClick={() => {
            setError(null);
            setConfirmSignout(true);
          }}
        >
          {busy === "logout" ? "Signing out..." : "Sign out"}
        </button>
      </div>
      {confirmSignout ? (
        <SignoutConfirmation
          busy={busy === "logout"}
          error={error?.message}
          onCancel={() => setConfirmSignout(false)}
          onConfirm={() => {
            void signOut();
          }}
        />
      ) : null}
    </>
  );
}
