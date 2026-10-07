# Boundary check (ADR-001)

```bash
node scripts/check-boundaries.mjs
pnpm boundaries
```

Fails CI on cross-module `infrastructure` imports or `platform -> modules` imports.
Cross-domain work must go through application contracts or domain events in `packages/events`.
