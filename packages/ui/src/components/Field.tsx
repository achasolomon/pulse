import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  inputId: string;
  children: ReactNode;
}

function FieldShell({ label, hint, error, inputId, children }: FieldShellProps) {
  return (
    <div className="pulse-field">
      <label className="pulse-field__label" htmlFor={inputId}>
        {label}
      </label>
      {children}
      {error !== undefined ? (
        <span className="pulse-field__error" role="alert">
          {error}
        </span>
      ) : hint !== undefined ? (
        <span className="pulse-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, id, className, ...props }: InputProps) {
  const inputId = id ?? useId();
  return (
    <FieldShell
      label={label}
      inputId={inputId}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
    >
      <input
        id={inputId}
        className={['pulse-input', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={error !== undefined || undefined}
        {...props}
      />
    </FieldShell>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Textarea({ label, hint, error, id, className, ...props }: TextareaProps) {
  const inputId = id ?? useId();
  return (
    <FieldShell
      label={label}
      inputId={inputId}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
    >
      <textarea
        id={inputId}
        className={['pulse-textarea', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={error !== undefined || undefined}
        {...props}
      />
    </FieldShell>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export function Select({ label, hint, error, id, className, options, ...props }: SelectProps) {
  const inputId = id ?? useId();
  return (
    <FieldShell
      label={label}
      inputId={inputId}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
    >
      <select
        id={inputId}
        className={['pulse-select', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={error !== undefined || undefined}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
