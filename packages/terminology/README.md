# @pulse/terminology

Versioned value-set lookup (PULSE-ENG-001 §51, ANAT-001 §8).

Rules enforced here:
- Internal IDs are stable Pulse identifiers; standard mappings are versioned and never silently rewrite history.
- Local/specialty codes stay explicitly namespaced (`local:<namespace>:<code>`).
- Unknown codes are returned as unmapped — callers must not guess mappings.

Sprint 07 ships the contract + in-memory client. A terminology-server
backed client (FHIR `$lookup`/`$validate-code`) lands with the R4 gateway.
