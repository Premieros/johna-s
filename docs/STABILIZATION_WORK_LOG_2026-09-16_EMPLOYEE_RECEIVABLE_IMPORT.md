# 2026-09-16 — Employee Historical Receivables Production Import

Repository: `Premieros/johna-s`
Production Supabase ONLY: `azzdesuowpdcoflmyezn`
Production branch: `main`
Execution baseline: `main@9de1986289edcc913b8d74ca2a4b878d2833a27e`
Parent containing PR #143: `95fb02b362108fc0ade0fb6705775416d01fd834`
Branch: `فرع نادي سموحة`
branch_id: `19c3fd23-d784-455b-8840-f4f2ac619651`
Source file: `42aa7096-671c-45d6-8ee9-33d30d325b97.xlsx`
Source period: 2026-09-01 through 2026-09-15

## Source extraction

- 17 employees.
- 130 movements, all `Sales Order` rows.
- No Deposit/action rows were present in the complete source.
- Historical movement total: **7,405.45 EGP**.
- Opening balance total: **18,188.50 EGP**.
- Closing/current account total: **25,593.95 EGP**.
- Employee names were preserved as reported.
- No employee customer was linked to `users`.

Three employees have a zero opening balance: `Eslam nady`, `بلال محمد`, `شيف خالد`. `employee_receivable_entries.amount` enforces `amount > 0`, therefore no artificial zero-value opening entry was created for them; their closing balances are represented exactly by their historical charges.

## Production schema verification

- `public.employee_receivable_entries` exists with the expected branch/customer/type/reference unique constraint and positive-amount constraint.
- `get_employee_receivable_balances` and `receive_employee_receivable_payment` exist with the PR #143 Permission-First definitions.
- `src/features/accounting/pages/EmployeeReceivablesPage.tsx` reads `customer_type='employee'` customers and `get_employee_receivable_balances`.
- Operational schema matches PR #143.
- Important migration-history discrepancy: `supabase_migrations.schema_migrations` contains no `20260916013000` entry and no `20260916%` rows. This operation did not fabricate or backfill migration history.

## Import method

- Separate Production Data Operation; not a migration.
- Idempotent customer matching by branch + normalized trimmed name.
- The branch had zero customer rows before this import, so all 17 employee customers were newly created without matching ambiguity.
- All imported customers use `customer_type='employee'` and `employee_user_id IS NULL`.
- Historical rows preserve original report timestamp, old Sales Order ID as `reference_number`, and exact amount.
- Positive opening balances use deterministic `OPENING-EMP-<stable-key>` references.
- Historical inserts use the existing uniqueness contract `(branch_id, customer_id, entry_type, reference_number)` and `ON CONFLICT DO NOTHING`.
- The write ran inside one transaction with assertions for source counts/totals, customer mapping, row amount/timestamp parity, and every employee closing balance. Any mismatch would roll back the full operation.

## Result

- Employee customers: **17**.
- `historical_charge`: **130** rows, **7,405.45 EGP**.
- Positive `opening_balance`: **14** rows, **18,188.50 EGP**.
- Total open/closing receivable: **25,593.95 EGP**.
- Per-employee verification passed with no 0.01 difference.

Confirmed examples:

- `Chef Ahmed`: 2,580.00 opening + 420.00 historical = **3,000.00**.
- `M Eslam`: 3,424.00 opening + 1,517.00 historical = **4,941.00**.
- `M Wasem`: 2,043.00 opening + 1,030.45 historical = **3,073.45**.

Authenticated `get_employee_receivable_balances` verification returned all 17 imported employee balances exactly.

## Regression / side-effect verification

Pre/post Production snapshots were identical for the targeted operational areas:

- `sales`: count 5, total 1,590.00, paid 1,590.00, refunded 1,340.00 — unchanged.
- `shifts`: count 4, opening sum 3,500.00, expected 4,670.00, actual 1,170.00, difference -3,500.00 — unchanged.
- `raw_material_inventory`: count 234, quantity 12,872.5165, avg-cost sum 11,483.108218 — unchanged.
- `raw_material_batches`: count 1,079, quantity 12,872.5165, cost sum 96,217.08 — unchanged.
- `inventory_unit_entries`: count 3, quantity 0.08 — unchanged.
- `inventory`, `inventory_batches`, `stock_transactions`, and `inventory_movements` remained at their same pre-operation values.

No POS sale, stock deduction, KDS row, print action, or shift mutation was created by the import.

## UI verification status

The current main page code is confirmed to load employee customers and the same `get_employee_receivable_balances` RPC. The Production RPC returned the exact 17 balances above. An independent authenticated browser session was not available in the execution environment, therefore runtime visual rendering was not claimed.

## Documentation note

A direct replacement update of `docs/STABILIZATION_WORK_LOG.md` through the GitHub connector was blocked by connector safety handling. No direct `main` write was attempted. This checkpoint file preserves the actual execution result on the documentation branch for PR review.
