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

PR #98 was subsequently merged to `main`; post-merge Verify main #1245 and Deploy #625 were Full Green, including Production API parity and Browser Smoke. Production Supabase was not manually modified.

## PR5 — Sales / POS / Tables / Kitchen / Payments closure checkpoint

Branch: `development/pr5-sales-pos-kitchen`
PR: #99
Base: `main@eaed1c4aee771d2f5ed3c5722e2f1daedcddd0ca`
Detailed evidence: `docs/PR5_SALES_POS_KITCHEN_CLOSURE.md`

### Audit result

Existing POS/Kitchen/Payment contracts were reviewed before any write. The audit confirmed granular Permission-First POS permissions, server-side Kitchen delta consumption, pinned order warehouse behavior, payment/offline ambiguity safeguards, split-payment atomicity, and scoped table/operator ownership. Existing green behavior was not reopened without evidence.

### Coverage gap and change

The missing proof was a true concurrent Kitchen Send using two database sessions against the same order. `tests/integration/kitchen_send_concurrency.test.ts` now proves the second caller blocks behind the first order-row `FOR UPDATE`, then resumes as a no-op after the first commit. Final inventory decreases once and only one KDS/send row is created.

The test passed on Fresh DB. No defect in `send_to_kitchen` Business Logic was found, so **no runtime SQL, migration, POS rule, payment rule, or user data was changed**.

### UX gate

POS/Kitchen/Payments/Tables were reviewed for missing required actions, duplicate controls, unclear status/help, prerequisite guidance, dangerous-action clarity, Arabic-first/RTL, and unnecessary steps. No proven UX regression required a change, so no cosmetic redesign was introduced simply to expand PR scope.

### Verification checkpoint

Implementation commit `e025de3ca641e3e611b41086c4ae32861cbb306b` passed repository identity, API parity, lint, application/test typecheck, unit, build, Fresh DB migrations, schema, Permission-First seed/drift checks, integration/security/RLS, and the new true-concurrency regression in Verify #1246.

Closure documentation changes the branch HEAD, therefore PR #99 still requires a fresh Full Verify on the documentation-complete HEAD before merge. Production Supabase writes during PR5: **NONE**.
