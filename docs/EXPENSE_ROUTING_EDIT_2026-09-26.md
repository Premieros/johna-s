# EXPENSE ROUTING & SAFE EDIT — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/expense-routing-edit-20260926`
Current PR: `#375`
Last updated: 2026-09-26

## Work status
State: **BLOCKED**

## Guardrails
- No direct changes to `main`.
- No Production migration until exact-head Full Verify is Green and explicit approval is given.
- No historical expense, treasury, journal, sales, purchase, or report data is rewritten by this work.
- Printing / Print Agent / printer routing / KDS / send-to-kitchen are untouched.
- Expense edits must preserve accounting truth through reversal + replacement, never silent mutation of posted journal history.
- Permission-First remains mandatory; Super Admin is the only implicit bypass.
- Branch isolation and existing RLS/report source-of-truth behavior must remain unchanged.

## Baseline
- Base: `main@bc86d3e79aa43e6b4fb6fe8af009e8df8a54701a`.
- Existing expense posting already creates balanced GL entries through `post_shift_expense`.
- Existing reversal already preserves the original posting and marks it voided.
- The Expenses UI still requires manual account/payment-source selection and has no safe edit flow.
- Reports already treat `status='posted'` as the authoritative expense population in current closing/reporting paths.

## Root-cause ledger
1. Expense category is only a label; it is not stored as a reusable branch-scoped accounting routing rule.
2. Users must choose the expense GL account and treasury/bank source repeatedly.
3. The UI exposes reversal but not a controlled edit workflow.
4. Direct UPDATE of a posted expense would desynchronize GL, treasury, shift operations, audit history and reports, so edit must be implemented as an atomic accounting replacement.
5. Routing/edit capabilities need separate permissions instead of widening `expenses.manage`.

## Change ledger
- Added forward-only migration `20260926013000_expense_routing_edit_contract.sql`.
- Added `expense_routing_rules` table scoped by branch and category; no historical backfill or data rewrite.
- Added `get_expense_routing_rules` and `upsert_expense_routing_rule` RPCs.
- Added `edit_shift_expense` RPC: lock original -> require open shift -> reverse original -> repost replacement -> audit old/new values in one transaction.
- Added permissions `expenses.edit` and `expenses.routing.manage` with permission dependencies.
- Added accounting API bindings for routing and editing.
- Expenses page now auto-applies a saved route by category, exposes routing setup only to authorized users, and exposes edit only to authorized users for the active shift.
- Existing reverse action remains available.
- Added integration coverage for routing without historical rewrite, replacement reconciliation, and closed-shift edit blocking.
- Printing/KDS/agents were not modified.

## Verification ledger
- Branch created from exact `main@bc86d3e79aa43e6b4fb6fe8af009e8df8a54701a`.
- Pre-PR compare: branch ahead only, behind by 0.
- Draft PR #375 opened.
- Verify main run `36199186389`: started; mandatory active-worklog pointer was stale from completed PR #374, so this log/pointer correction is being committed before interpreting runtime/type/test results.
- Exact-head Full Verify run `36199390597` on `3c2a204a575a3c22d022b7cdc2ce34501d0a3ccc`: **FULL GREEN** — worklog gate ✅, Supabase identity ✅, API contract ✅, lint ✅, app/test typecheck ✅, unit ✅, build ✅, canonical migrations ✅, schema ✅, integration + security/RLS ✅, Browser Smoke ✅.
- Final docs-head exact verification after recording this result: pending.

## Production gate
- Production migration: **BLOCKED**.
- Merge: **BLOCKED**.
- Required before either: exact-head Full Verify Green, latest-main recheck, report/accounting reconciliation review, and explicit user approval.
- No Production SQL write has been performed.

## Next action
1. Update mandatory worklog pointer to this branch/PR.
2. Re-run exact-head CI and inspect lint, typecheck, unit, build, fresh DB/schema and integration results.
3. Fix only failures attributable to this scope.
4. Recheck that no report path counts both voided original and posted replacement.
5. Stop before merge/Production migration and request explicit approval.

## Mandatory update protocol
- Before every repository write, verify branch HEAD is the expected prior head and `main` has not unexpectedly moved.
- After every code batch, update **Change ledger**.
- After every workflow/test result, update **Verification ledger**.
- Any unexpected branch/main divergence requires STOP_AND_RECONCILE.
- Before merge, exact-head Full Verify must be Green.
- Before Production migration, exact-head Full Verify Green + explicit approval are both mandatory.
