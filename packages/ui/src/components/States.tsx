import type { ReactNode } from 'react';
import { Button } from './Button.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/** Empty worklists explain what belongs here and how to proceed (UX-001 §27). */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="pulse-empty">
      <p className="pulse-empty__title">{title}</p>
      {description !== undefined ? <p>{description}</p> : null}
      {action !== undefined ? (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
}

/** Failed loads keep context and offer retry (UX-001 §26, FE-001 §25). */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this data. Check your connection and try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="pulse-error-state" role="alert">
      <p className="pulse-error-state__title">{title}</p>
      <p>{description}</p>
      {onRetry !== undefined ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export interface LoadingSkeletonProps {
  width?: string;
  height?: string;
  /** Number of stacked skeleton rows. */
  rows?: number;
}

/** Loading must not shift patient identity/context (UX-001 §28). */
export function LoadingSkeleton({ width = '100%', height = '16px', rows = 1 }: LoadingSkeletonProps) {
  return (
    <div aria-busy="true" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className="pulse-skeleton"
          style={{ width, height, marginBottom: i === rows - 1 ? 0 : 8 }}
        />
      ))}
    </div>
  );
}
