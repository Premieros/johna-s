# Production Deployment Log — 2026-09-17

## Scope

Repository: `Premieros/johna-s`

Production Supabase: `azzdesuowpdcoflmyezn`

Source baseline: `main@51b15e23a74c4630d25d4101dfd197609f6275da` (`Merge PR #174: day close and expense GL contract`).

No other repository or database was touched. Print Agent files and mobile branch were not modified.

## Production schema reconciliation

Production was inspected before any DDL. The merged frontend expected Day Close / Shift Closing Report / Expense GL / open-order shift-close override RPCs, but Production did not yet contain them.

Because Production already contained a later migration (`20260917125849_sent_only_order_settlement`) while the merged finance contract originated from an earlier repository migration timestamp, the reconciliation was applied forward-only as new Production migrations rather than rewriting migration history.

Applied Production migrations:

1. `reconcile_shift_day_close_expense_gl_post_174`
   - adds the missing `expenses` financial linkage/status columns and indexes;
   - adds `daily_closes` with RLS;
   - restores server-authoritative `post_shift_expense` / `reverse_shift_expense`;
   - adds `day_close` and `get_shift_closing_report`;
   - removes direct authenticated expense writes and keeps Permission-First RPC flow.

2. `reconcile_shift_close_guard_post_174`
   - installs the final normal `close_shift` contract from the merged shift hardening;
   - normal close blocks effective open/held unpaid orders with `OPEN_ORDERS_BLOCK_SHIFT_CLOSE`;
   - hardened `SECURITY DEFINER` search path and explicit execute grants.

3. `reconcile_shift_close_open_orders_override_post_174`
   - installs `close_shift_with_open_orders`;
   - requires `shifts.close` plus `shifts.close_with_open_orders` unless the existing Super Admin implicit bypass applies;
   - preserves open operational orders/tables while closing the drawer/shift and logs the override.

No reset/reseed/data rewrite was performed.

## Post-migration verification

Production verification confirmed all required merged contracts are present:

- `day_close(uuid,date)` ✅
- `get_shift_closing_report(uuid)` ✅
- `close_shift_with_open_orders(uuid,numeric,text)` ✅
- `post_shift_expense(...)` ✅
- `reverse_shift_expense(uuid,text)` ✅
- `daily_closes` table ✅
- `expenses.shift_id` ✅

## Deployment

This documentation-only branch is used to trigger a normal reviewed merge to `main`; GitHub Pages deployment remains governed by `.github/workflows/deploy.yml`, including:

- locked Production Supabase identity check;
- frontend API contract check;
- Production API parity check;
- GitHub Pages deployment only after those gates pass.

Published target: `https://premieros.github.io/johna-s/`
