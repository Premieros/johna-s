# SHIFT CLOSING / TREASURY REPORT RECONCILIATION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/shift-closing-treasury-report-20261003`
Baseline: `main@06f3045de8b47dc59fdee95a0c7e535b81ef8b8c`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

## Production verification before change
- Smouha and Cleopatra both have no open shift at the verification time.
- No open orders in the recent operating window.
- Cloud Print jobs in both branches reached terminal `submitted` state with submitted timestamps; no recent print errors/backlog.
- Database: 0 idle-in-transaction, 0 lock waits; the only long active session is the normal Realtime WAL sender waiting for WAL.
- No Production write was made during this health check.

## Root cause
1. Payment breakdown mixes physical tenders with `credit` / `employee_credit`, even though receivables are not collected funds.
2. Average ticket is derived from `raw.net_revenue`, which subtracts expenses; it must use `raw.net_sales`.
3. Drawer reconciliation prints all shift expenses as cash-drawer expenses, although authoritative drawer cash is determined by `shift_operations`.
4. A4 labels `netSales` as “Net Revenue” while thermal text separately prints `netRevenue`; the same report therefore uses conflicting terminology.
5. Expense details do not explain whether the expense affected the cashier drawer or another treasury/bank source.

## Implementation
- Add pure financial-presentation helpers for:
  - collected vs receivable payment methods;
  - average ticket;
  - drawer vs non-drawer expense source.
- Load the shift’s existing `shift_operations` in the authoritative report adapter.
- Keep `raw.expenses`, `raw.net_sales`, `raw.net_revenue`, expected drawer and treasury balances authoritative; only change presentation/classification.
- Mark each expense detail as drawer-affecting only when an authoritative cash expense operation references it.
- Align A4, thermal text and thermal HTML labels/sections.
- Add unit/contract regression tests using the verified Smouha figures.

## Safety
- No DB migration.
- No Production write.
- No changes to sales, payment, accounting journals, treasury posting, printing, KDS or kitchen.
- Merge remains blocked until exact-head CI is Green and explicit approval is given.
