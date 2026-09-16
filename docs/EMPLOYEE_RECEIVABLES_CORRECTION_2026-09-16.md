# Employee receivables correction — 2026-09-16

Source of truth supplied by the owner:
- `cl 1-14 (1).xlsx`
- `cl 15.xls.xlsx`

## Owner clarification
The supplied amounts are **opening balances only**. They are not transaction history, are not linked to sales, and have no linked payments.

Therefore the correct model is:
- exactly one `opening_balance` row per employee;
- no synthetic historical sales rows;
- no synthetic payment rows;
- future real POS credit sales and real receivable payments continue normally after the opening balance.

## Correct opening balances

| Employee | Opening balance |
|---|---:|
| Chef Ahmed | 595.00 |
| Eslam nady | 75.00 |
| Gana | 190.00 |
| kariman | 25.00 |
| M Eslam | 1,527.00 |
| M Wasem | 1,130.45 |
| Mariam cap | 590.00 |
| mohamed c | 80.00 |
| Mr George | 405.00 |
| Rewan | 295.00 |
| احمد السعدني | 830.00 |
| بلال محمد | 75.00 |
| شيف خالد | 448.00 |
| عبدالفتاح | 50.00 |
| محمد ياسر | 25.00 |
| مصطفى فهمى | 725.00 |
| ملك | 755.00 |

## UI change
`EmployeeReceivablesPage` opens a dedicated statement view for each employee. At cutover, the statement shows the single opening-balance row. After that, actual system sales and actual receivable payments appear as real movements with date, type, reference, description, method/source, debit, credit/paid, and running balance.

## Safety
- No inventory, POS, KDS, print, pricing, or payment-authority logic is changed.
- No Production schema migration is required.
- `scripts/employee_receivables_2026_09_15_correction.sql` is a guarded manual Production data correction and is intentionally not a migration.
- The correction removes the previously imported synthetic employee-receivable ledger rows for the target branch and replaces them with one correct opening balance per employee.
- The script aborts if the employee population differs from the expected 17 records, if an employee does not end with exactly one opening entry, or if any final balance differs from the approved totals.
