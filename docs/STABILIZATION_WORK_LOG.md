# Stabilization Work Log — Live

Date: 2026-09-16
Repository: `Premieros/johna-s`
Production branch: `main`
Production Supabase ONLY: `azzdesuowpdcoflmyezn`
Source of Truth: `docs/CURRENT_WORK_PLAN.md`

> The previous long-form stabilization history is preserved verbatim at `docs/archive/STABILIZATION_WORK_LOG_PRE_PR5_2026-09-13.md`. Detailed same-day checkpoints remain in the dated/addendum logs. This live log keeps only the active guardrails plus the latest checkpoints needed to resume work safely.

## Permanent execution guardrails

- No direct writes to `main`; no Force Push.
- Never use another repository or Supabase project.
- Permission-First authorization; Super Admin only implicit bypass.
- No weakening RLS/tests.
- No deletion/reset/reseed/rewrite of user data, balances, settings, invoices, stock, or working models for convenience.
- Migrations are forward-only / append-only.
- No Production migration before Full Verify Green and explicit approval.
- Before each write/merge: fetch current `main`, current work branch/PR, and check newer work.
- Standard gate: `Baseline -> Root cause -> Small change -> Focused tests -> Integration/Regression -> Full Verify -> Merge -> Verify main -> Deploy`.
- Mandatory UX Acceptance Gate applies to every touched surface without broad redesign or authorization/business-rule drift.
- Current printing/Print Agent/routing remains frozen unless separately scoped and approved.

## Current synchronized baseline — 2026-09-16

- Current `main`: `b88ba29e5aa071e7d10bd7a19f7c6eed2341f9dd`.
- Latest merged PR: #152 — **Fix dashboard data display and default period**.
- Merge commit message records **Full Verify #1523 Green** on the exact PR head before merge.
- Current open PR inventory at this checkpoint: PR #132 only, **Draft/Open**, for the Android dining-room waiter app on `development/mobile-delivery-app`.
- Mobile work remains isolated from core stabilization; do not cross-edit or push to that branch from the core workstream.

## Recent merged work now reflected in `main`

### PR #148 — Dining table occupancy reconciliation

- Rebuilt from current main after superseding stale/failing PR #145.
- Centralizes dining-table occupancy reconciliation from effective active orders/items.
- Empty orders do not occupy a table; positive effective items do.
- Removing/zeroing the final effective item frees the table.
- Prevents stale vacancy when another effective active/held order still occupies the table.
- No printing/KDS/inventory/accounting redesign.

### PR #149 — Compact dashboard / numeric display cleanup

- UI-only dashboard cleanup.
- Compact toolbar/quick actions.
- Shared numeric formatting with thousands separators and cleaner zero/fraction display.
- No database, RLS, POS, inventory, shift, KDS, or printing logic changes.

### PR #150 — Employee opening receivables + statements

- Corrected the employee data model so owner-provided amounts are treated as opening balances, not synthetic transaction/payment history.
- Added a dedicated full statement per employee receivable account.
- Statement includes date, movement type, transaction/reference, description, method/source, debit, credit/paid, and running balance.
- Opening state is exactly one `opening_balance` row per employee; future actual sales/payments continue through canonical flows.
- No schema migration, inventory/POS/KDS/printing authority change, or Production data write was performed by the PR itself.

### PR #151 — Numeric integrity across balances, receivables, and reports

- Customer list/export uses computed AR rather than stale stored balance.
- Supplier list/export uses computed AP rather than stale stored balance.
- AR aging/summary includes employee opening receivables.
- Employee collection routes through the canonical settlement path.
- Corrected numeric aggregation issues in reports/dashboard without weakening permissions/RLS.

### PR #152 — Dashboard data display and default period

- Replaced split dashboard surfaces with one period/branch-aware data surface.
- Defaults to the current calendar month so existing monthly data is visible immediately.
- Keeps today / 7 days / month / year controls.
- Isolates optional sales/payment/inventory/sale-item source failures so one failing source cannot blank the full dashboard.
- Uses canonical net-sale/payment/refund helpers and keeps accounting net profit sourced from `get_income_statement`.
- No Production migration, RLS change, or printing change.
- Merge commit confirms Full Verify #1523 Green before merge.

## Parallel mobile workstream

- Branch: `development/mobile-delivery-app`.
- PR: #132 — Draft / Open.
- Purpose: live Android app for dining-room waiter/captain using existing authentication, branch visibility, tables, catalog, modifiers, canonical order create/update, and `send_to_kitchen`.
- No service-role key in Android, no mobile-specific DB migration/backend fork, no direct inventory writes, no Production changes, and no Print Agent changes.
- Payment/split/transfer/approval execution remains in the existing POS until separately wired and regression-tested.
- Do not merge without explicit approval.

## Still pending / independently gated

1. Production trial-sales cleanup remains a separate administrative task if still required; do not bypass destructive-action protection and do not rewrite stock to make counts match.
2. Any unapplied Production migration must be determined from current `main`, pass the required Full Verify, and receive explicit Production approval.
3. Final handover still requires regression verification on the exact handover head, including Permission-First, branch/warehouse isolation, RLS/security, Kitchen stock authority, approvals, and Browser Smoke where applicable.
4. Every new core workstream must branch from the latest `main`, not from historical baselines recorded earlier in this log.

## Resume point

Core system work resumes from `main@b88ba29e5aa071e7d10bd7a19f7c6eed2341f9dd` or a later verified `main` if it moves. Re-check open PRs before writing. PR #132 remains isolated. Do not reopen completed work without a demonstrated regression.
