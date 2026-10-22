"use client";
import { useEffect, useRef } from "react";
import type { PublicSession } from "../lib/session.js";
import { FacilitySelection } from "./facility-selection.js";

export function FacilityDialog({
  open,
  session,
  onClose,
}: {
  open: boolean;
  session: PublicSession;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="facility-dialog"
      aria-labelledby="facility-heading"
      onCancel={onClose}
      onClose={onClose}
    >
      <button
        type="button"
        className="facility-dialog__close"
        aria-label="Close facility selection"
        onClick={onClose}
      >
        ×
      </button>
      <h2 id="facility-heading">Select facility</h2>
      <FacilitySelection session={session} />
    </dialog>
  );
}
