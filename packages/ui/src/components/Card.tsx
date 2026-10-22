import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  children: ReactNode;
}

export function Card({ title, className, children, ...props }: CardProps) {
  return (
    <section
      className={['pulse-card', className ?? ''].filter(Boolean).join(' ')}
      {...props}
    >
      {title !== undefined ? <h3 className="pulse-card__title">{title}</h3> : null}
      {children}
    </section>
  );
}
