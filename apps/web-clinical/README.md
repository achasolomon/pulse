# web-clinical — Sprint 01 shell

Clinician/nursing/diagnostic operations surface (`PULSE-FE-001`, `PULSE-UX-001`).

Sprint 01: static shell only — sidebar nav (12 domains per brand iconography), facility selector placeholder, patient-banner empty state, `Ctrl+K` search stub. No clinical logic, no PHI.

Tokens duplicated from `@pulse/ui` as CSS vars in `app/globals.css` (Deep Teal `#075E54`, Clinical Teal `#0B7A6B`, Inter / Plus Jakarta Sans).

```bash
pnpm --filter web-clinical dev   # :3001
pnpm --filter web-clinical build
```
