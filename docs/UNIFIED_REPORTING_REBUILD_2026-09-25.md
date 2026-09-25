# UNIFIED REPORTING REBUILD — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/component-consumption-reconciliation-20260925`
Current PR: `#373`
Last updated: 2026-09-25

## Work status
State: **BLOCKED**

Implementation is in review. Merge and Production application remain blocked until exact-head Full Verify is Green and Production application receives explicit approval.

## Guardrails
- Single writer on this reporting branch.
- No direct changes to `main`.
- No Production migration from this branch before exact-head Full Verify Green + explicit approval.
- Printing / Print Agent / routing / KDS / send-to-kitchen are out of scope and untouched.
- Reporting changes are read-only with respect to sales, inventory quantities, payments, shifts and accounting business data.
- Permission-First and branch visibility remain mandatory.
- Legacy report code may remain for compatibility, but legacy/ambiguous reports are removed from discovery before physical deletion.

## Baseline
- Base: `main@29f99187574fd700cee5da6b71d9b4b13339022c`.
- Existing reporting was split between `ReportsPage`, `FinancialReportsPage`, Costing Center RPCs and direct-table queries.
- Production read-only audit found a semantic mismatch in net sales:
  - Cleopatra 2026-09-01..2026-09-25 canonical net sales: 509,064.21.
  - old Costing Center net sales: 446,547.60.
  - difference: 62,516.61, equal to tax in scope.
- Component reconciliation baseline:
  - theoretical value: 94,955.78.
  - actual matched ledger value: 92,928.68.
  - difference: 2,027.10.
  - 33 raw-material quantity mismatches.

## Root-cause ledger
1. `get_costing_sales_summary` defined net sales as `total - tax`, while day close/reporting defined net sales as `total - refunded_amount`.
2. Operational reports, finance reports and costing used separate UI entry points and multiple independent data paths.
3. Legacy component reports still used `stock_transactions.component_flow`, which no longer represents the canonical raw-consumption path.
4. Financial navigation left the reports center and opened a separate financial page.
5. The same business label could therefore represent different formulas depending on page.

## Change ledger
- Added `docs/UNIFIED_REPORTING_REBUILD_2026-09-25.md` as this active log and source-of-truth map.
- Added read-only sales/component reconciliation RPC and report UI.
- Added `private.report_net_sale_amount(total, refunded_amount)` as canonical reporting net-sales helper.
- Reworked `get_costing_sales_summary` and `get_order_margin` to use canonical net sales.
- Preserved COGS resolution order: accounting journal -> settled kitchen -> legacy sale ledger fallback.
- Unified `/reports` and legacy `/financial-reports` on `ReportsCenterPage`.
- Added operational/financial sections inside the unified center.
- Redirected financial shortcuts to `/reports?section=financial&view=...`.
- Hid legacy duplicate component/manufacturing reports from report discovery.
- Removed legacy duplicate report options from the active operational selector.
- Added Excel profile/source note for component reconciliation.
- Added unit contracts for component reconciliation and unified reporting source-of-truth behavior.
- Removed the duplicate Financial Reports sidebar entry and made the single Reports entry accessible with either `reports.view` or `reports.financial`.
- Added any-of permission support to navigation, command palette and the `/reports` route while keeping `/financial-reports` as a compatibility alias.

## Verification ledger
- Production inspection: read-only only.
- Cleopatra canonical-vs-old net-sales mismatch reproduced: 62,516.61.
- Cleopatra component reconciliation reproduced: theoretical 94,955.78 vs actual 92,928.68.
- PR #373 marked ready to trigger exact-head Verify.
- Verify run 36188959349 started on prior head; mandatory log pointer was still stale from merged performance work and is being corrected by this update.
- Verify #2841 on head `2a5c27fafe518a5cdb76da5e72c67464897c3843` reached lint/typecheck successfully and failed only in 5 unit assertions tied to the new unified navigation/formatting contracts.
- Fixed all five assertions without weakening authorization or business-source tests: central percent formatter, financial deep-link identity, explicit any-of permission contract, intentional alias discoverability, and canonical helper regex.
- Current exact-head Full Verify: **PENDING**.
- Added navigation permission contract test after unifying the sidebar destination.

## Production gate
- Production migration: **BLOCKED**.
- Merge: **BLOCKED**.
- Required before merge:
  1. exact-head Full Verify Green;
  2. no type/lint/unit/build regressions;
  3. source-of-truth contract tests Green.
- Required before Production migration:
  1. merged main verification Green;
  2. explicit Production approval.
- No Production SQL write has been executed from this branch.

## Next action
1. Point `docs/CURRENT_WORK_PLAN.md` mandatory gate to this log/branch/PR.
2. Re-run exact-head Verify on the resulting head.
3. Fix any lint/type/unit/build failures without weakening tests.
4. Audit report catalog for any remaining duplicate labels/sources.
5. Keep merge and Production application blocked until all gates are Green.

## Mandatory update protocol
- Before every repository write, verify the branch HEAD is the expected prior head.
- After every code batch, update **Change ledger**.
- After every measurement/test/workflow, update **Verification ledger**.
- Before any merge decision, update **Production gate** with exact-head Verify status.
- After any interruption, tool error, conflict or unexpected commit, re-read this log and `docs/CURRENT_WORK_PLAN.md` before resuming.
