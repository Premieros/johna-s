# Performance Root-Fix — 2026-09-24

Repository: `Premieros/johna-s`  
Branch: `development/performance-rootfix-20260924`  
Baseline: `main@3c1aa6047893b5f2e47be575c08e0db8dbd581b5`  
Production Supabase: `azzdesuowpdcoflmyezn`

## Guardrails

- No direct writes to `main`; no force push.
- Permission-First remains mandatory; Super Admin is the only implicit bypass.
- Do not weaken RLS, history visibility, branch isolation, or tests.
- Printing / Print Agent / printer routing / KDS / `send_to_kitchen` are out of scope and frozen.
- Production inspection is read-only until exact-head Full Verify Green plus explicit Production migration approval.
- Migrations are forward-only / append-only.

## Baseline after PR #351 / #353

PR #351 is merged and Production migration `20260924070415_reporting_truth_and_reconciliation` is applied.
Latest observed `main` is PR #353 at `3c1aa6047893b5f2e47be575c08e0db8dbd581b5`.

Recent Production RPC latency sample (2026-09-24 01:45–07:46 UTC):

| RPC | Calls | Avg | P95 / Max |
| --- | ---: | ---: | ---: |
| get_income_statement | 15 | 2298 ms | 5369 ms |
| get_trial_balance | 10 | 1508 ms | 3381 ms |
| get_general_ledger | 5 | 876 ms | 3041 ms |
| get_balance_sheet | 5 | 864 ms | 2075 ms |
| get_cash_flow | 7 | 715 ms | 1534 ms |
| get_journals | 2 | 192 ms | 298 ms |
| get_costing_sales_summary | 2 | 104 ms | 106 ms |

No recent `search_inventory_ledger` calls existed in this six-hour sample, so the previously reproduced timeout remains a code-path defect to fix structurally rather than being declared healthy from absence of traffic.

## Confirmed Inventory Ledger root cause

The live Production definition of `public.search_inventory_ledger` currently evaluates both `public.user_may_access_branch(il.branch_id)` and `private.financial_reference_visible(...)` during the hot ledger scan.

The reference visibility helper dispatches into sale/purchase/expense/customer-payment/supplier-payment visibility functions, which eventually invoke `private.financial_row_visible`. That helper repeatedly evaluates branch access, `history.unlimited`, visibility settings, business-day cutoff, and deterministic historical sampling.

This preserves authorization semantics but makes row scanning expensive and is consistent with the reproduced statement timeouts.

## Phase 1 — Inventory Ledger root fix

Status: IMPLEMENTED / VERIFY GREEN THROUGH DB+INTEGRATION; Browser Smoke pending on the earlier head.

Implementation intent:

1. Keep the RPC signature and 51-row keyset contract unchanged.
2. Authenticate and verify `inventory.ledger.view` once.
3. Resolve the caller's branch-access set once.
4. Resolve `history.unlimited`, recent-window cutoff, and historical percentage once.
5. Preserve referenced-row visibility semantics for sales/refunds, purchases/returns, expenses, customer payments, supplier payments, and fallback ledger references.
6. Keep the exact deterministic historical bucket formula.
7. Remove per-ledger-row authorization helper calls from the hot scan.
8. Preserve full server-side search and keyset pagination.
9. Add structural and integration regressions for branch isolation, recent visibility, historical sampling, unlimited history, and referenced-row semantics.

## Phase 2 — Financial journal RLS root fix

Status: IN PROGRESS.

Production read-only evidence using the same authenticated Super Admin behind the slow requests:

- September branch journal aggregate under current RLS: ~2031.8 ms.
- Same aggregate as database owner without row-policy overhead: ~10.9 ms.
- Current RLS plan reopened `journal_entries` from `journal_entry_lines` for every visible line and re-ran:
  - `private.journal_entry_read_visible_by_id`
  - `private.financial_reference_visible`
  - `public.user_may_access_branch`
- Observed inner journal lookup loops: 1696 for the measured aggregate.
- Slow Production calls were from Super Admin sessions, so this repeated work adds no authorization value for that caller: Super Admin is already the sole implicit bypass by project contract.

Implementation:

- Add `(SELECT public.is_pos_admin())` as a statement-level fast-path to:
  - `auth_select_journal_entries`
  - `financial_visibility_journal_entries`
  - `auth_select_journal_entry_lines`
  - `financial_visibility_journal_entry_lines`
- Preserve all existing non-admin branch and financial visibility predicates exactly.
- Keep financial visibility policies RESTRICTIVE.
- Add unit and integration regressions proving Super Admin cross-branch visibility remains unchanged and ordinary users remain branch-scoped.

## Next phases

- Re-run exact-head Full Verify after Phase 2.
- Measure income statement / trial balance / general ledger after deployment readiness; do not infer Production improvement before the migration is actually approved/applied.
- Confirmed UI failures and invalid-selection handling.
- Confirmed UI failures and invalid-selection handling.
- Auth/session 401 bursts after separating real user traffic from scanner/test traffic.
- Measured RLS/index adviser cleanup one item at a time.

## Production writes

NONE.
