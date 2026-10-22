"use client";
import { useEffect, useRef } from "react";
import { Alert, Button } from "@pulse/ui";

export function SignoutConfirmation({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, []);
  function dismiss() {
    if (busy) return;
    dialog.current?.close();
    onCancel();
  }
  return (
    <dialog
      ref={dialog}
      className="signout-dialog"
      aria-labelledby="signout-heading"
      aria-describedby="signout-description"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="signout-dialog__heading">
        <span className="signout-dialog__icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M10 4H5v16h5m3-12 4 4-4 4m-4-4h12"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 id="signout-heading">Sign out of Pulse?</h2>
      </div>
      <p id="signout-description">
        You’ll need to sign in again to access your workspace.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="signout-dialog__actions">
        <button
          ref={cancel}
          type="button"
          className="pulse-btn pulse-btn--secondary"
          disabled={busy}
          onClick={dismiss}
        >
          Stay signed in
        </button>
        <Button
          type="button"
          loading={busy}
          disabled={busy}
          onClick={onConfirm}
        >
          Sign out
        </Button>
      </div>
    </dialog>
  );
}
