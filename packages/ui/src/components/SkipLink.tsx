export interface SkipLinkProps {
  /** Target element id, without the hash (e.g. "main-content"). */
  targetId: string;
  children?: string;
}

/** First tab stop on every page (UX-001 §30 keyboard/landmarks). */
export function SkipLink({ targetId, children = 'Skip to main content' }: SkipLinkProps) {
  return (
    <a
      className="pulse-skip-link"
      href={`#${targetId}`}
      onClick={(e) => {
        const el = document.getElementById(targetId);
        if (el !== null) {
          e.preventDefault();
          el.focus();
          el.scrollIntoView();
        }
      }}
    >
      {children}
    </a>
  );
}
