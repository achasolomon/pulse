"use client";
import { useEffect, useRef, useState } from "react";

type FacilityOption = { facilityId: string; facilityName: string; organizationName: string };

export function FacilityPicker({ id, value, facilities, onChange, disabled = false, compact = false }: {
  id: string;
  value: string;
  facilities: FacilityOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", at: 0 });
  const selected = facilities.find(f => f.facilityId === value);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  function show(index?: number) {
    setActive(index ?? Math.max(0, facilities.findIndex(f => f.facilityId === value)));
    setOpen(true);
  }
  function choose(index: number) {
    const option = facilities[index];
    if (!option) return;
    setOpen(false);
    trigger.current?.focus();
    if (option.facilityId !== value) onChange(option.facilityId);
  }
  return (
    <div ref={root} className={`facility-picker${compact ? " facility-picker--compact" : ""}`} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <span id={`${id}-label`} className={compact ? "sr-only" : "facility-picker__label"}>Facility</span>
      <button ref={trigger} id={id} type="button" role="combobox" aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        disabled={disabled || !ready || !facilities.length} className="facility-picker__trigger"
        onClick={() => open ? setOpen(false) : show()}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); event.stopPropagation(); }
          else if (event.key === "Tab") setOpen(false);
          else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "Home") show(0);
            else if (event.key === "End") show(facilities.length - 1);
            else if (!open) show();
            else setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + facilities.length) % facilities.length);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(active); else show();
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const now = Date.now();
            search.current = { text: (now - search.current.at < 700 ? search.current.text : "") + event.key.toLowerCase(), at: now };
            const match = facilities.findIndex(f => f.facilityName.toLowerCase().startsWith(search.current.text));
            if (match >= 0) show(match);
          }
        }}>
        <svg className="facility-picker__building" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 21V5h10v16M14 10h6v11M2 21h20M8 9h2M8 13h2M8 17h2M17 14h1M17 18h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span id={`${id}-value`}>{selected?.facilityName ?? (facilities.length ? "Select a facility" : "No facility access")}</span>
        <svg className="facility-picker__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && !disabled ? (
        <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="facility-picker__list">
          {facilities.map((facility, index) => (
            <li key={facility.facilityId} id={`${id}-option-${index}`} role="option" aria-selected={facility.facilityId === value}
              className={`facility-picker__option${active === index ? " facility-picker__option--active" : ""}`}
              onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
              <span><strong>{facility.facilityName}</strong><small>{facility.organizationName}</small></span>
              {facility.facilityId === value ? <span className="facility-picker__check" aria-hidden="true">✓</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
