# Employee receivables period report — 2026-11-02

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/employee-receivables-report-only-20261102`
Current PR: #579
Last updated: 2026-11-02
State: **BLOCKED**

## Work status

Owner clarified the requested feature is a **report only**. The result is a separate read-only report in Reports Center, not a modification of the Employee Receivables operational screen or the individual employee statement screen.

The report defaults to the current Cairo month, supports an inclusive custom From/To period, lists every employee account in the active accessible branch, shows opening balance / period debit / period credit-paid / closing balance, aggregates those figures across all employees, and supports Excel export.

## Guardrails

- Repository: `Premieros/johna-s`; production Supabase: `azzdesuowpdcoflmyezn`.
- Do not modify the Employee Receivables list screen or the individual statement screen.
- Do not change employee balance, payment allocation, sales, journal, receivable, POS, KDS, printing, inventory or FIFO business logic.
- This is a read-only reporting path only. No database data writes, balance recalculations persisted to storage, payments, journal posting or backfill.
- The additive SQL function is `STABLE SECURITY INVOKER`, branch-scoped, checks `accounts.view`, and retains caller RLS/history visibility.
- No Production migration or deployment without a separate release decision after exact-head checks.
- Keep data access bounded to one report RPC per selected period; no per-employee request loops.

## Baseline

- Main baseline: `d72208b6e8945448ab634885130ea1d5e8b4d13e`.
- The current employee list and employee statement screens remain unchanged from main.
- Existing canonical employee receivable balances are exposed through `get_employee_receivable_balances`.
- Existing employee statement movements use the customer-linked posted journal line grain of `get_party_statement`.
- Existing history visibility is enforced by `history_clamp_from/to` and caller RLS; older results may be sampled without `history.unlimited`.

## Root-cause ledger

- The operational employee list shows today's open balances and aging buckets only; it does not offer a period-based aggregate report.
- The individual employee statement is not the requested placement. The owner explicitly rejected changing either operational screen or the work logic.
- A report cannot treat today's open balance as a past closing balance. The read-only projection reverses visible journal activity after the selected period from today's canonical open balance, then derives the selected-period opening balance from the selected-period debit and credit totals.
- Without full history permission, older journal rows remain subject to existing financial visibility sampling; the report warns that older period totals may be incomplete.

## Change ledger

- Add an independent Employee Receivables report view to the existing Reports Center report chooser. No changes to the operational Employee Receivables page or statement page.
- Add one bounded read-only RPC, `get_employee_receivables_period_summary(branch, from, to)`, returning one row per employee.
- Use the existing `get_employee_receivable_balances` function for the current canonical outstanding baseline and visible customer-linked journal lines for period movements.
- Derive opening, period debit, period credit/paid and closing values in memory/database response only; never write results back.
- Add report-only date range controls, current-month preset, aggregate totals, employee table, and Excel export.
- Add DB integration coverage for totals, RLS branch isolation, permission denial and invalid ranges; add Playwright coverage for report placement and custom period.
- Earlier draft PR #578 attempted to place date controls on employee screens. It was closed unmerged after the owner's clarification and must not be revived or released.

## Verification ledger

- Report-only candidate PR: [#579](https://github.com/Premieros/johna-s/pull/579), draft.
- Migration is an additive read-only function; not applied to Production.
- Focused integration and Playwright coverage has been added but exact-head CI has not yet completed.
- No production UI, SQL, balance, journal or payment change is claimed.

## Production gate

- **Not merged / not deployed.**
- PR #579 remains draft until all exact-head Verify main jobs pass.
- The SQL migration, if included in a future approved release, must be applied separately from GitHub Pages publication and only after explicit approval.
- No Production data mutation or transaction is authorized.

## Next action

Run exact-head Verify main for PR #579. Review the SQL function in isolated CI PostgreSQL, verify that the report totals agree with the fixture's canonical employee balance and statement movements, then fix any real failures without weakening checks. Keep the PR draft and unpublished until verification and release approval.

## Mandatory update protocol

Update this log for every material finding and exact-head check. Keep report-only changes isolated from operational screens and business writers. CI must fail when this log is missing or incomplete. Never claim merge or deployment until the required checks and Pages publication are independently verified.
