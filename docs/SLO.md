# Pulse Service Objectives (NFR-001 baseline, EPIC-23)

Design targets, not contractual SLAs. Measured from the consumer's perspective where feasible; synthetic `/health/*` checks do not substitute.

| Tier | Examples | Availability target | p95 latency target |
|---|---|---|---|
| C0 critical | patient lookup, encounter open, prescribe, dispense verify | 99.9% monthly | < 500ms app-side |
| C1 important | lab/imaging order→result, eMAR, billing capture | 99.5% monthly | < 1s app-side |
| C2 routine | reports, analytics extracts, portal reads | 99.0% monthly | < 3s app-side |

## Budgets and behavior

- Every production SLO names service, scope, indicator, window, exclusions, owner (NFR-001 §5).
- `pulse_http_requests_total` + `pulse_http_latency_ms_bucket` (see `/api/v1/metrics`) are the current SLIs; alerting thresholds land with the metrics backend in R5.
- Clinical correctness is not reducible to uptime: SLO breaches on C0 trigger safety review (SAFE-001), not just paging.
- Auth surfaces carry stricter abuse budgets: portal login 5/min/IP, default API 300/min/IP (in-memory; Redis-backed counting with multi-instance deploy).
