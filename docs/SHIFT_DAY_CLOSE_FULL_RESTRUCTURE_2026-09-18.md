# Shift & Day Close Full Restructure — 2026-09-18

## Identity
- Repository: `Premieros/johna-s`
- Base: `main@696e0965b2405b07a4ae9e8aafdcabaf6d49c31d`
- Branch: `development/shift-day-close-full-restructure`
- Production Supabase remains `azzdesuowpdcoflmyezn`
- No Production migration has been applied by this work.

## Requested behavior
1. Shift close must reconcile drawer cash after expenses.
2. Shift closing receipt/report must show all expenses.
3. Every user must be shown with individual totals/details.
4. Day close must include all shifts.
5. Day close must include cash purchases and subtract their net cash outflow.
6. Day report must show all underlying sales, expenses, cash purchases and users without hiding rows.

## Implemented contract
### Shift
- New canonical helper: `_compute_shift_expected_cash(uuid)`.
- Normal close and open-order override use the same cash equation as the report.
- Cash equation includes:
  - opening balance
  - + cash sales
  - + cash in
  - - cash refunds
  - - cash expenses
  - - cash out
  - - historical unlinked cash expenses in the shift time window
- `get_shift_closing_report` now returns:
  - shift metadata
  - all linked sales
  - all posted shift expenses
  - refund operations
  - payment method totals
  - per-user totals plus nested sales/expense/refund detail
  - treasury balances

### Day close
- `daily_closes.report_snapshot` stores an immutable JSON snapshot.
- New `_build_day_closing_report(branch,date)`.
- New `get_day_closing_report(branch,date)`.
- Day close requires no open shifts.
- First close stores the complete snapshot; later report reads return the same snapshot.
- Day report includes:
  - every sale in the business date
  - every posted expense for the date
  - every cash purchase for the date
  - every overlapping shift
  - every involved user
  - payment-method summary
  - full row detail arrays
- Financial outputs are deliberately separated:
  - net sales
  - net after expenses
  - net after expenses and cash purchases
  - cash sales
  - cash expenses
  - cash purchases
  - cash after outflows

## Frontend
- Shift Z/A4 reports now print expense details and per-user results.
- New full A4 day-close report prints all shifts, users, expenses, cash purchases and sales.
- Shifts page now has:
  - Full Day Report
  - Close Day
  - business-date selector
  - close guard for open shifts
  - print after successful close

## Safety
- Permission-First preserved.
- No role-name authorization added.
- No RLS weakening.
- No direct client financial writes added.
- No Production migration until Full Verify Green and explicit approval.
