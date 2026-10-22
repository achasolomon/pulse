import type { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export function TableWrap({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['pulse-table-wrap', className ?? ''].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
}

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Required accessible caption (table purpose), per UX-001 §21. */
  caption: string;
  children: ReactNode;
}

export function Table({ caption, className, children, ...props }: TableProps) {
  return (
    <table className={['pulse-table', className ?? ''].filter(Boolean).join(' ')} {...props}>
      <caption>{caption}</caption>
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}

export function Th({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={className} {...props}>
      {children}
    </th>
  );
}

export function Td({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={className} {...props}>
      {children}
    </td>
  );
}
