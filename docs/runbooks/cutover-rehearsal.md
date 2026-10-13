# Cutover Rehearsal Runbook (MIG-001, ONB-001, EPIC-24)

Rehearse before go-live (ONB-001 §32; MIG-SR-018: at least one full rehearsal
at representative scale). This runbook maps the dress rehearsal (MIG-001 §77)
onto `scripts/cutover-rehearsal.mjs`.

## Prerequisites

- Source environment migrated and seeded:
  `node scripts/db-migrate.mjs` then `psql $DATABASE_URL -f infra/seeds/demo-facility.sql`
  and `-f infra/seeds/demo-clinical.sql` (representative clinical records for
  Appendix C sample validation).
- Docker container with the postgres server (or local pg tools on PATH).
- Nobody writes to the source during the rehearsal window (the script *proves*
  the freeze: any source change between transfer baseline and post-load
  manifest fails the run).

## Running

```bash
export DATABASE_URL="postgresql://<user>@<host>:<port>/pulse"   # source env
node scripts/cutover-rehearsal.mjs --docker <container>
```

Exit code 0 = **GO**, 1 = **NO-GO**. Output is a JSON verdict.

## Phase map (script ↔ MIG-001)

| Script phase | MIG-001 | What it proves |
|---|---|---|
| baseline | §75 Dry Run 1, App. B baseline extraction | Profile + control totals (row counts + content checksums) for every table |
| delta (×2, idempotent) | §80 Delta migration | Late-arriving change captured; **repeated delta is idempotent** (watermark stable) |
| migrate | App. B, exit checklist | Target schema comes **only from source-controlled migrations** |
| load (timed) | §77/§78 | Data-only extraction/load throughput; feeds the window estimate |
| freeze | §79 Freeze strategy | Source bit-identical across the transfer window — no ambiguous dual-write |
| reconcile + clinical sample | §76, §98, App. C | Automated reconciliation; any mismatch = **M0 defect → NO-GO** (MIG-SR-015); patient/encounter/signed-note rows present |
| rollback drill | §77 rollback decision drill | Revert to a clean migrated known-good, timed — the "what if we stand down" path |
| verdict | §83 go/no-go | GO/NO-GO + `cutoverWindowEstimateSeconds` = (migrate+load+reconcile) × 1.5 contingency (§78) |

## Go/No-Go checklist (MIG-001 Appendix C)

**Script-verified (automatic):**
- [ ] Patient identity / clinical / medication / diagnostics sample: table counts + checksums match target
- [ ] Documents presence/hash (row-level md5 in manifest)
- [ ] Operations: backup taken before rehearsal (see `backup-dr-drill.md`), rollback rehearsed
- [ ] No M0 defects (mismatches, freeze violation, non-idempotent delta, failed rollback drill)

**Manual before real cutover (authority sign-off, §82):**
- [ ] Finance opening balances (MIG-SR-012) and inventory opening quantities (MIG-SR-013) validated by finance/inventory leads
- [ ] Active orders reconciliation lists reviewed by clinical leads (§235, MIG-SR-006)
- [ ] Staging access controls / disposal (MIG-SR-017) confirmed by security
- [ ] Named go/no-go authorities signed (Appendix C "Approval")
- [ ] Performance: rehearsal timings + contingency accepted by Cutover Manager (§78, §83)

**Blocked if:** any unresolved M0/M1 defect (MIG-SR-015), rollback drill failed,
or source freeze could not be held.

## Timeline (MIG-001 §83)

T-30 readiness → T-14 mapping/config freeze → **T-7 rehearsal closeout**
(run this script at representative scale; fix defects; re-run until GO) →
T-1 backup/extract prep → T0 freeze/final extract → transform/load →
reconcile → clinical validation → go/no-go → open Pulse → hypercare.

## Reading the verdict

- `defects[]` — each entry is an M0: fix source/target divergence, then re-run.
- `phasesSeconds` — feed real numbers back into the T0 minute plan (§915).
- `cutoverWindowEstimateSeconds` — the window to book (includes contingency).
- `rollback.seconds` — measured stand-down time (basis for the rollback
  decision threshold agreed with clinical leadership).

Rehearsals are repeatable: each run drops and recreates the target database
(`TARGET_DB`, default `pulse_cutover`). Use `--keep-target` to inspect a
loaded target (skips the rollback drill).
