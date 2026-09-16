# Employee receivables correction — 2026-09-16

Source of truth supplied by the owner:
- `cl 1-14 (1).xlsx` — employee receivable transactions for September 1–14.
- `cl 15.xls.xlsx` — employee receivable transactions for September 15.

## Root cause
The previous import added pre-September `opening_balance` rows on top of the September transaction history. The September historical charges themselves are mostly valid. Some September 15 rows were also missing.

## Approved balances through 2026-09-15

| Employee | 1–14 | Sep 15 | Correct balance |
|---|---:|---:|---:|
| Chef Ahmed | 365.00 | 230.00 | 595.00 |
| Eslam nady | 75.00 | 0.00 | 75.00 |
| Gana | 70.00 | 120.00 | 190.00 |
| kariman | 25.00 | 0.00 | 25.00 |
| M Eslam | 1,507.00 | 20.00 | 1,527.00 |
| M Wasem | 1,030.45 | 100.00 | 1,130.45 |
| Mariam cap | 590.00 | 0.00 | 590.00 |
| mohamed c | 60.00 | 20.00 | 80.00 |
| Mr George | 405.00 | 0.00 | 405.00 |
| Rewan | 295.00 | 0.00 | 295.00 |
| احمد السعدني | 820.00 | 10.00 | 830.00 |
| بلال محمد | 75.00 | 0.00 | 75.00 |
| شيف خالد | 448.00 | 0.00 | 448.00 |
| عبدالفتاح | 50.00 | 0.00 | 50.00 |
| محمد ياسر | 25.00 | 0.00 | 25.00 |
| مصطفى فهمى | 690.00 | 35.00 | 725.00 |
| ملك | 655.00 | 100.00 | 755.00 |

## Missing Sep 15 transactions identified
- Chef Ahmed: ref 12674 — 175.00
- M Eslam: ref 12607 — 10.00
- M Wasem: ref 12702 — 100.00
- mohamed c: ref 12620 — 20.00
- احمد السعدني: ref 12699 — 10.00
- ملك: ref 12694 — 100.00

The already imported Sep 15 rows for Chef Ahmed (12675), Gana (12606), M Eslam (12643), and مصطفى فهمى (12593) are preserved.

## UI change
`EmployeeReceivablesPage` now opens a dedicated full statement screen for each employee. The statement includes date, movement type, transaction/reference number, description, method/source, debit, credit/paid, and running balance.

## Safety
- No inventory, POS, KDS, print, or payment authority logic is changed.
- No Production schema migration is required for this correction.
- `scripts/employee_receivables_2026_09_15_correction.sql` is a guarded, manual Production data correction and is intentionally not a migration.
- The script aborts if the employee population differs from the expected 17 records or if any final balance differs from the approved source totals.
