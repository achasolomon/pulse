export function RecordIcon({ kind, size = 20 }: { kind: string; size?: number }) {
  const paths: Record<string, string> = {
    patient: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M17 11h6",
    entries: "M6 3v5a4 4 0 0 0 8 0V3 M4 3h4 M12 3h4 M10 12v3a5 5 0 0 0 10 0v-2 M20 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
    medications: "m9 15 6-6 M5 19a5 5 0 0 1 0-7l7-7a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7 0Z",
    investigations: "M9 3h6 M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3 M8 15h8",
    notes: "M14 3H5v18h14V8 M14 3v5h5 M8 12h8 M8 16h6",
    visits: "M7 3v4 M17 3v4 M3 10h18 M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2 M8 14h3 M8 17h7",
    documents: "M8 3h9l4 4v11H8Z M4 7H3v15h13v-1 M17 3v5h4",
    allergy: "M12 3v10 M12 17v1 M10 3h4l7 17H3Z",
    vitals: "M3 12h4l3-7 4 14 3-7h4",
    pressure: "M4 16a9 9 0 1 1 16 0 M6 16h12v5H6Z M12 12l4-5 M6 8l1 1 M17 9l1-1",
    heart: "M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-5 5 1 10 8 15 7-5 13-10 8-15Z M3 11h5l2-3 3 6 2-3h6",
    temperature: "M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z M12 8v10 M17 5h3 M17 9h2",
    lungs: "M12 3v9 M12 8 8 5c-3 2-5 6-5 12 0 3 6 3 7 0v-5 M12 8l4-3c3 2 5 6 5 12 0 3-6 3-7 0v-5",
    oxygen: "M12 3C9 8 5 11 5 15a7 7 0 0 0 14 0c0-4-4-7-7-12Z M8 15h2l1-3 2 6 1-3h2",
    weight: "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z M8 8a5 5 0 0 1 8 0l-4 5Z M12 10l2-3",
    height: "M10 3h4 M12 3v18 M10 21h4 M7 6h3 M7 10h3 M7 14h3 M7 18h3",
    facility: "M4 21V5h16v16 M9 21v-5h6v5 M9 8h6 M12 5v6",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind] ?? paths.notes} /></svg>;
}
