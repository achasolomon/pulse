import type { ReactNode } from 'react';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ErrorCircleIcon,
  InfoCircleIcon,
} from '../icons.js';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const TONE_ICON = {
  info: InfoCircleIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  error: ErrorCircleIcon,
} as const;

export interface AlertProps {
  tone: AlertTone;
  title?: string;
  children: ReactNode;
}

/** Page/workflow-level message; errors use role=alert (UX-001 §24/§26). */
export function Alert({ tone, title, children }: AlertProps) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      className={`pulse-alert pulse-alert--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className="pulse-alert__icon">
        <Icon size={16} />
      </span>
      <div>
        {title !== undefined ? <p className="pulse-alert__title">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
