# Employee receivables period view — 2026-11-02

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/employee-receivables-period-view-20261102`
Current PR: #578
Last updated: 2026-11-02
State: **BLOCKED**

## Work status

Implement a date period selector in the employee receivable statement. The default period is the current Cairo month through the current Cairo business date; users can choose a custom inclusive From/To range and apply it explicitly. Each statement shows brought-forward balance, period debits, period credits/payments, and period-end balance.

## Guardrails

- Repository is `Premieros/johna-s`; production database identity is `azzdesuowpdcoflmyezn`.
- Frontend/service/tests only. No Supabase migration, schema/RLS change, production data write, or database action.
- Do not change opening balances, sales, payments, journals, employee debt, stock, FIFO, POS, KDS or printing writers.
- Preserve the current employee receivable source, existing RPC permissions, branch scope and history visibility.
- Do not add per-employee request loops or a second price/balance source.

## Baseline

- Main baseline: `d72208b6e8945448ab634885130ea1d5e8b4d13e` (PR #564 merged and GitHub Pages deployed).
- Employee list uses `get_employee_receivable_balances`; employee statements use `get_party_statement` plus the existing opening-balance residual calculation.
- The current statement already loads the permitted movement set once. Period filtering can be calculated in memory without another request.

## Root-cause ledger

- The employee statement was fixed to `OPENING_DATE` through the current date and displayed the full movement history without From/To controls.
- The summary cards always displayed all-time debit/credit totals and current balance, so the user could not review a month or chosen interval.
- Using the operational current balance as a past-period closing balance would be incorrect. The candidate preserves the existing opening baseline and recomputes the starting balance by applying movements before the chosen range, then applies only movements inside the inclusive period.
- The statement source is subject to the existing database history clamp. The UI must not widen that access; without `history.unlimited`, the visible detail period is limited to the existing recent seven-day window and older amounts remain carried forward.

## Change ledger

- Add a current-month default based on the `Africa/Cairo` business date.
- Add editable date inputs, validation, an explicit Apply action, and a Current Month shortcut.
- Show Opening Balance, Debit in Period, Paid/Credit in Period, and Closing Balance.
- Rebuild visible running balances from the existing opening baseline and the movement rows already loaded by the feature service.
- Use the Cairo business date for the balance snapshot.
- Add pure unit tests for date boundaries and period arithmetic, plus Playwright coverage of current-month default and custom period filtering.
- No new RPC, migration, extra per-employee query, journal write or debt mutation.

## Verification ledger

- Source review confirms the page remains behind `employeeReceivableDetail` service access; no direct Supabase call was added to the page.
- Focused unit tests and the new Playwright scenario are committed, but exact-head CI is still pending.
- Verify main run [41510206501](https://github.com/Premieros/johna-s/actions/runs/41510206501) is queued for candidate head `91995b0f5143242d36ae2bbb82d2ffb169df889b`.
- No successful CI result or production visual test is claimed yet.

## Production gate

- PR #578 is draft and not merged.
- No production deployment or Supabase migration is authorized or required for this frontend-only candidate.
- Do not publish until exact-head required checks pass and the user approves the release.

## Next action

Inspect all exact-head Verify jobs for PR #578. Fix any genuine unit, TypeScript, lint, database-contract or Playwright failure without weakening required coverage. Keep PR draft until the full result is green.

## Mandatory update protocol

Record each material finding and exact-head check. Keep merge, GitHub Pages publication and Supabase changes separate. CI must fail when the mandatory log is missing or incomplete. Never claim deployed before GitHub Pages confirms the exact verified SHA.
