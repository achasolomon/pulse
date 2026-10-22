# Sprint W01 — Design-system foundation + brand shell (UI Phase)

**Status:** done
**Specs:** UX-001 §3–§34 (experience architecture, global shell, patient banner, tokens, typography, colour semantics, buttons/forms/tables/status, error/empty/loading states, accessibility, responsive, keyboard); FE-001 §4–§19 (repo layout, feature architecture, design system, semantic colour, typography, responsive, accessibility, state categories); brand/ boards (palette hexes, Inter + Plus Jakarta Sans, logo lockups, dashboard mockup as visual target); BACKLOG F01.5 (tokens package, accessible primitives, role workspace shell, patient context component stubbed/tested).

## Scope

- [x] `packages/ui` (`@pulse/ui`): full design-token set — brand + semantic + neutral colours, type scale (Inter Variable body / Plus Jakarta Sans Variable headings, weights), 4px spacing scale, radius, elevation, border, z-index, motion — exported as TS constants AND generated `:root` CSS custom properties (`pulseTokensCss` / `pulseCssVariables`), values matching the brand board hexes exactly (tested).
- [x] `packages/ui`: accessible React primitives, token-driven, each with tests (vitest + testing-library, 19 tests): Button (primary/secondary/danger, `loading` sets aria-busy + disables duplicate submit), Input/Select/Textarea (labels, hints, error with role=alert, aria-invalid), Card, StatusBadge (icon + text — never colour alone), Alert (error→role=alert, info→role=status), EmptyState (with action), ErrorState (role=alert + Retry), LoadingSkeleton (aria-busy/label, reduced-motion safe), Table primitives (caption, columnheaders), PatientContextBanner (persistent identity strip: name/MRN/age/sex/encounter + allergy & isolation flags as text; explicit empty state), Modal (focus trap, Esc, labelled dialog, focus restore), SkipLink; `'use client'` barrel for App Router.
- [x] `apps/web-clinical`: self-hosted brand fonts (@fontsource-variable Inter + Plus Jakarta Sans); brand assets in `public/brand/` (horizontal/stacked/tagline lockups + emblem) and `app/icon.png` favicon; shell rebuilt per brand mockup — deep-teal sidebar (emblem + wordmark + tagline, 14 nav items with outline icons, aria-current active state), topbar (global search + Ctrl K hint, facility context, online indicator, notifications bell with count, user identity), persistent patient-context banner slot, responsive drawer <768px with scrim + open/close controls, skip link + `main` landmark + visible focus rings; webpack extensionAlias for nodenext-style `.js` specifiers in the workspace package.
- [x] Dashboard demo screen per brand mockup: greeting + live clock, 5 stat cards with semantic icon tiles, "Today's Clinic" tab strip + worklist table (status chips = icon + text + colour), Quick Actions rail incl. critical-alerts entry — static demo data (API wiring is W02+).
- [x] Tests: 19/19 in `@pulse/ui` (primitives + tokens); gates green.
- [x] Tracker: `docs/UI_TRACKER.md` created; W01 row → done.

## Non-goals

- API client / auth wiring (W02), live data on any screen, web-admin/web-patient apps, dark mode (UX-001 requires clinical readability validation first), tailwind/new styling frameworks (CSS custom properties from tokens per UX-001 §12), anatomical 3D (ANAT-001 later), offline UX (EPIC-21 edge UI later).

## Decisions

- **D1** — Tokens live in `@pulse/ui` (single package; FE-001's separate `design-tokens/` package deferred until a second app needs to consume tokens without React). CSS custom properties are generated from the TS source at module load and injected once via a `<style>` tag in the root layout — one source of truth, no drift (tested: hexes match brand board).
- **D2** — `@pulse/ui` barrel is a client module (`'use client'`): the kit is React primitives for the App Router; server layouts import tokens/components through the client boundary. Webpack `extensionAlias` bridges nodenext `.js` specifiers to `.tsx` sources.
- **D3** — Status is icon + text + colour everywhere (StatusBadge), per UX-001 §14/§23 and CLIN-001 ("not merely a colour change"); red/error reserved for danger-critical.
- **D4** — PatientContextBanner renders an explicit empty state when no patient is pinned (wrong-patient prevention UX-001 §7 — never silently stale); allergy/isolation flags are text chips.
- **D5** — Plain CSS + tokens (no styling framework): matches the established repo baseline, zero new runtime deps, and satisfies UX-001 §12 ("tokens are implementation artifacts"); revisit only if W03+ velocity demands it.
- **D6** — Static demo data on the dashboard: foundation sprint proves the design system and shell; FE-001 §24 (central API client, no scattered fetch) lands properly in W02 rather than ad-hoc fetches now.

## Evidence (live proof)

| Gate | Result |
|---|---|
| `@pulse/ui` tests | **19/19** (primitives a11y/behaviour + token brand-board fidelity) |
| Typecheck | `pnpm typecheck` 8/8 tasks clean (ui + web-clinical + api…) |
| Lint | oxlint 0/0 on `packages/ui` (15 files) and `web-clinical` (4 files) |
| Build | `pnpm build` 9 tasks; `next build` static prerender of `/` (First Load JS 89.4 kB) |
| Boundaries / secrets | clean (229 files; secrets scan clean) |
| Full monorepo tests | api 270/270 + @pulse/ui 19/19 |
| Live smoke (production `next start`) | HTTP 200; HTML contains injected token `--pulse-deep-teal: #075E54`, Inter + Plus Jakarta Sans Variable faces, skip link, sidebar active state, facility context, patient-banner empty state, status badges (incl. `Waiting (15m)` chip), clinic table caption, quick actions |
| Brand assets | `public/brand/` lockups + `app/icon.png` favicon served |

## Follow-ons

- W02 (next): typed API client + auth/session wiring (FE-001 §24–§25), tenant/facility context headers, session lifecycle; then W03 patients worklist + live patient banner.
- Turbo warning `no output files for @pulse/ui#build` is expected (typecheck-only package consumed via `transpilePackages`).
- Optional later: `design-tokens` split package, density modes (UX-001 §15), dark-mode readability study (UX-001 §12), icon set expansion per brand iconography board.
