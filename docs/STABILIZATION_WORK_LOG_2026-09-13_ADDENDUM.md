# Stabilization Work Log — 2026-09-13 Addendum

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Baseline: `main@a7abca8f0dd020f957b7abe9c084c35d1e4a51bd`

## Closure correction

The older live log and work-plan header predate the latest Catalog merges. Actual repository state now confirms:
- PR #92 / Catalog 6B: merged.
- PR #93 / Catalog 6C: merged.
- PR #95 / Catalog 6D: merged.
- Catalog 6A–6D are therefore closed as a program block.
- Latest post-merge Verify main #1233: success.
- Latest post-merge GitHub Pages Deploy #623: success.

## User execution authorization recorded

The user authorized continuing and merging the remaining planned stages when their required verification is Green, subject to one overriding condition: **existing user data, configuration, balances, and working models must not be damaged or rewritten for convenience.**

The detailed standing policy is recorded in `docs/EXECUTION_GUARDRAILS.md`.

## Mandatory UX review added to every remaining stage

For each touched workflow, the implementation must also review usability and completeness. Examples:
- add a missing button or navigation action when the supported operation otherwise cannot be reached;
- guide the user to missing prerequisites instead of exposing raw backend errors;
- remove or consolidate true duplicate controls after proving identical behavior;
- clarify ambiguous labels, statuses, warnings, and instructions;
- distinguish blocking errors from non-blocking warnings visually and textually;
- keep branch/warehouse/user context visible where it prevents mistakes;
- preserve permission-first visibility and action guards;
- add regression tests where a UX guard protects business behavior.

## Remaining roadmap

1. PR4 — Purchases End-to-End.
2. PR5 — Sales / POS / Tables / Kitchen / Payments.
3. PR6 — Shift / Finance / Reports.
4. PR7 — Confirmed Legacy Cleanup.

Separate track: PR #78 Premier Print Agent remains Draft / unmerged and keeps its own verification and Production migration gate.

## Stage merge gate

A remaining stage may be merged without asking for a fresh intermediate approval when all of these are true:
- diff remains within the planned stage scope;
- data-preservation policy is satisfied;
- focused tests and regression tests pass;
- permission/branch/warehouse/idempotency coverage passes where applicable;
- UX review for touched surfaces is complete;
- Full Verify is Green;
- no Production migration is applied before its verified deployment gate.

Any change that requires rewriting historical business data, changing balances, or migrating existing documents for convenience is outside this standing authorization and must be isolated rather than silently applied.

## PR4 — Purchases End-to-End closure checkpoint

Branch: `development/pr4-purchases`
PR: #98
Base: `main@658b86c91a120c7e634250758a38d4895ff72b9a`
Detailed evidence: `docs/PR4_PURCHASES_CLOSURE.md`

### Proven defect and fix

`receive_purchase_order` could reach GRN/receipt writes before a later helper rejected an unusable PO warehouse. The forward-only migration `20260913083000_purchase_receive_atomicity.sql` now preflights the warehouse before receipt allocation/writes, requires an active same-branch warehouse, keeps the PO `FOR UPDATE` serialization point, and introduces no branch/warehouse fallback.

No existing business rows are deleted, reset, reseeded, backfilled, or rewritten.

### Added regression coverage

- missing warehouse fails with zero receipt/stock/journal side effects;
- cross-branch warehouse fails closed;
- valid receive posts stock only to the PO warehouse;
- AP journal line retains the PO supplier;
- retry after completed receive does not duplicate GRN/stock/journal effects;
- PO row lock remains before receipt writes;
- pre-approval cancellation is side-effect free;
- post-approval cancellation is rejected with `BAD_TRANSITION`.

No quantity/hash duplicate heuristic was added because equal partial quantities can represent two valid physical receipts; the current RPC has no independent request-id that can distinguish replay safely.

### UX gate

The receiving surface was reviewed under the mandatory UX gate: Arabic-first/RTL preserved, touched error/status feedback clarified, and entered receipt quantity constrained to the remaining quantity without changing authorization or business rules. No broad redesign was introduced.

### Verification

Implementation/test head `6841962e5c65b9356033370d645a13e4cbe1aec5` passed Verify #1241 Full Green: lint, typecheck, unit, build, Fresh DB, schema, integration/security/RLS, and Browser Smoke all succeeded.

Closure documentation changed the branch head after #1241, so PR4 remains **pending one final Full Verify on the documentation-complete head before merge**.

Production Supabase writes during PR4 verification: **NONE**.
