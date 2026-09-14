# Branch Status Registry — johna-s

Last updated: 2026-09-15
Authoritative plan: `docs/CURRENT_WORK_PLAN.md`

## Rule

A branch is executable only if it is explicitly marked **ACTIVE** below. Any branch not listed as ACTIVE is **INACTIVE/HISTORICAL — DO NOT MERGE**. Re-activation requires first updating `docs/CURRENT_WORK_PLAN.md` with reason, scope, baseline, regression evidence, and expected PR.

This registry does not authorize direct writes to `main`, Force Push, Production migrations, RLS weakening, test weakening, or role-name authorization.

## ACTIVE

| Branch | Status | Purpose |
|---|---|---|
| `development/kds-branch-fixture-stabilization` | **ACTIVE FUNCTIONAL / DRAFT PR #126** | Narrow KDS branch-scoped station authorization regression only. Full Verify required before merge. |
| `development/status-registry-unification` | **ACTIVE DOCS-ONLY** | Unify execution records and branch status only. No runtime/business logic/database changes. |

## INACTIVE / HISTORICAL — DO NOT MERGE

The following branches remain historical artifacts only and are not part of the current execution plan:

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

## Safety interpretation

- Old Green CI does not make a historical branch safe to merge into a newer `main`.
- Old PR descriptions, work logs, closures, and addenda do not reactivate their branches.
- Historical branches may be deleted later as repository housekeeping, but deletion is separate from runtime stabilization and must not be mixed into an active functional fix.
- Before any merge: fetch current `main`, confirm the branch is ACTIVE here, confirm the PR HEAD, inspect changed files, and require the appropriate Full Verify gate.

## After PR #126 closes

Once PR #126 is merged or closed and post-merge verification is complete, it must be moved from ACTIVE to HISTORICAL. The next functional branch must be created fresh from the then-current `main` for the preservation-first stabilization/cleanup audit defined in `CURRENT_WORK_PLAN.md`.
