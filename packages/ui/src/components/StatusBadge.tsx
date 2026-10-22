import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ErrorCircleIcon,
  InfoCircleIcon,
  MinusCircleIcon,
} from '../icons.js';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const TONE_ICON: Record<BadgeTone, (props: { size?: number }) => JSX.Element> = {
  neutral: MinusCircleIcon,
  info: InfoCircleIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  error: ErrorCircleIcon,
};

export interface StatusBadgeProps {
  tone: BadgeTone;
  /** Required visible text — status is never colour-only (UX-001 §14/§23). */
  label: string;
}

/**
 * Clinical status chip: icon + text carry the meaning; colour is supplementary
 * (UX-001 §14). Red/error is reserved for danger-critical states.
 */
export function StatusBadge({ tone, label }: StatusBadgeProps) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={`pulse-badge pulse-badge--${tone}`}>
      <span className="pulse-badge__icon">
        <Icon size={12} />
      </span>
      {label}
    </span>
  );
}
