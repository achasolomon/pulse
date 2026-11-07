"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function SettingsDrawer({
  id,
  title,
  description,
  busy,
  onClose,
  children,
  footerActions,
  onBeforeClose,
  className,
  closeLabel = 'Cancel',
}: {
  id: string;
  title: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  footerActions?: ReactNode;
  onBeforeClose?: () => boolean;
  className?: string;
  closeLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  function dismiss() {
    if (busy || (onBeforeClose && !onBeforeClose())) return;
    dialog.current?.close();
    onClose();
  }
  return (
    <dialog
      ref={dialog}
      id={id}
      className={`settings-drawer${className ? " " + className : ""}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onKeyDown={(event)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss();}}}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          dismiss();
      }}
    >
      <div className="settings-drawer__handle" aria-hidden="true" />
      <header className="settings-drawer__header">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p id={`${id}-description`}>{description}</p>
        </div>
        <button
          type="button"
          className="settings-drawer__close"
          aria-label={`Close ${title}`}
          disabled={busy}
          onClick={dismiss}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m6 6 12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      <div className="settings-drawer__body">{children}</div>
      <footer className="settings-drawer__footer">
        <button
          type="button"
          className="pulse-btn pulse-btn--secondary"
          disabled={busy}
          onClick={dismiss}
        >
          {closeLabel}
        </button>
        {footerActions}
      </footer>
    </dialog>
  );
}
