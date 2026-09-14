# Branch Status Registry — johna-s

Last updated: 2026-09-15
Authoritative plan: `docs/CURRENT_WORK_PLAN.md`

## Rule
A branch is executable only if explicitly marked **ACTIVE** below. Any branch not ACTIVE is **INACTIVE/HISTORICAL — DO NOT MERGE**. Re-activation requires updating `CURRENT_WORK_PLAN.md` first with reason, scope, baseline and regression evidence.

## ACTIVE
- `development/status-registry-unification-v2` — **ACTIVE DOCS-ONLY**. Purpose: unify records and branch status. No runtime/business logic/database changes.

There is currently **no ACTIVE functional development branch** after PR #126 merged.

## INACTIVE / HISTORICAL — DO NOT MERGE
- `development/architecture-baseline`
- `development/branch-stations-print-agent`
- `development/branch-stations-print-agent-v2`
- `development/catalog-6b-unit-links`
- `development/catalog-6c-dead-wrappers`
- `development/catalog-6d-rpc-boundary`
- `development/catalog-manufactured-modifier-groups`
- `development/catalog-simplification`
- `development/cloud-print-agent`
- `development/global-branch-context`
- `development/global-branch-context-completion`
- `development/inventory-contracts`
- `development/kds-branch-fixture-stabilization`
- `development/kds-branch-fixture-stabilization-copy`
- `development/kitchen-station-hardening-current-main`
- `development/main-db-test-isolation`
- `development/mobile-cart-sizing-hotfix`
- `development/mobile-ordering-literal-ui`
- `development/mobile-ordering-ui-only`
- `development/mobile-ordering-ui-phase-2`
- `development/pos-order-ownership-transfer`
- `development/pr4-purchases`
- `development/pr5-sales-pos-kitchen`
- `development/pr6-shift-finance-reports`
- `development/pr7-confirmed-legacy-cleanup`
- `development/print-agent-clean-merge-final2`
- `development/print-agent-cloud-clean`
- `development/print-agent-final-clean`
- `development/print-agent-final-merge`
- `development/print-agent-final-validated`
- `development/print-agent-merge-clean-2`
- `development/print-agent-merge-final`
- `development/print-agent-merge-ready`
- `development/print-agent-station-routing`
- `development/print-agent-test-print-fix`
- `development/print-agent-unified`
- `development/purchases-receive-atomicity`
- `development/stabilize-pos-mobile-branch-catalog`
- `development/station-category-cashier-hardening`
- `development/station-receipt-contract`
- `development/station-receipt-contract-v2`
- `development/status-registry-unification` — superseded by v2 after main moved during PR #126 merge.

## Safety interpretation
- Old Green CI does not make a historical branch safe to merge into newer `main`.
- Old work logs/closures/addenda do not reactivate branches.
- Physical deletion of inactive branches is optional housekeeping and separate from functional stabilization.
- Before any merge: fetch current `main`, confirm ACTIVE status, confirm PR HEAD, inspect changed files, and satisfy the current Full Verify gate.

## Next functional branch
After post-merge Verify/Deploy for PR #126 are Green and this registry update is closed, create a **fresh branch from then-current main** for the preservation-first stabilization/cleanup audit. Do not reuse a historical branch.
