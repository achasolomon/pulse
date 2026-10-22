import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'md' | 'sm';
  /** Loading disables duplicate submission (UX-001 §17). */
  loading?: boolean;
  children: ReactNode;
}

/**
 * One clear primary action per task region (UX-001 §17). `loading` sets
 * aria-busy and disables the control so double submits cannot fire.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = [
    'pulse-btn',
    `pulse-btn--${variant}`,
    size === 'sm' ? 'pulse-btn--sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? 'Please wait…' : children}
    </button>
  );
}
