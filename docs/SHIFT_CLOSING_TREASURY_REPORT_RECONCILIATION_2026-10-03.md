# SHIFT CLOSING / TREASURY REPORT RECONCILIATION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/shift-closing-treasury-report-20261003`
Current PR: `#434`
Baseline: `main@06f3045de8b47dc59fdee95a0c7e535b81ef8b8c`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to `main`; no force push; single writer.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- No Production DB/schema/migration/data write in this reporting track.
- Sales, payments, treasury journal posting, printing, Print Agent, KDS, printer routing and `send_to_kitchen` remain frozen.
- Report changes may classify and present financial truth, but must not mutate financial truth.

## Baseline
- Latest `main` baseline: `06f3045de8b47dc59fdee95a0c7e535b81ef8b8c`.
- PR #433 ERP-04 is merged and its Production migration was applied and verified before this track.
- No open PR existed when this branch was created.
- Restaurant health was verified read-only before implementation:
  - Smouha and Cleopatra had no open shifts at the verification time.
  - No open orders were present in the recent operating window.
  - Cloud Print jobs reached terminal `submitted` state with timestamps; no recent print errors or backlog.
  - Database had 0 idle-in-transaction sessions and 0 lock waits.
  - The only long active session was normal Realtime WAL replication waiting for WAL.

## Root-cause ledger
1. Payment breakdown mixes physical tenders with `credit` / `employee_credit`, even though receivables are not collected funds.
2. Verified Smouha figures: net sales 13,421 EGP = cash 3,694 + card 9,375 + customer credit 352; physical collection is therefore 13,069 EGP.
3. Average ticket is derived from `raw.net_revenue`, which subtracts expenses; it must use `raw.net_sales`.
4. Drawer reconciliation prints all shift expenses as cash-drawer expenses, although authoritative drawer cash is determined by `shift_operations`.
5. The two 1,000 EGP Smouha expenses were posted from organization `main_cash`, not the cashier drawer; no shift expense operation exists for them.
6. A4 labels `netSales` as “Net Revenue” while thermal text separately prints `netRevenue`, creating conflicting terminology.
7. Expense details do not explain whether an expense affected the cashier drawer or another treasury/bank source.

## Change ledger
- Added pure report math helpers for:
  - collected vs receivable payment methods;
  - average ticket from net sales;
  - drawer vs non-drawer expense source.
- Authoritative shift report adapter now loads existing `shift_operations` for drawer-expense classification only.
- Average ticket now uses `net_sales / invoice_count`.
- A4 and thermal output separate collected tenders from uncollected receivables.
- A4 and thermal drawer reconciliation distinguish drawer expenses from expenses outside the drawer.
- Expense detail rows expose whether the expense affected the shift drawer.
- Net-sales / after-expenses terminology is aligned between A4 and thermal.
- Added regression tests using the verified Smouha figures.
- No DB migration and no Production write.

## Verification ledger
- Pre-write main/branch reconcile: clean.
- Draft PR: #434.
- First CI run `37085538353` stopped at the mandatory worklog gate before lint/tests.
- Root cause: required worklog headings and three literal plan guardrail phrases were missing.
- Runtime/report code was not implicated in that failure.
- Documentation-only correction is being applied before re-running exact-head CI.
- Supabase Preview is skipped for this PR because preview-per-PR is disabled and this track has no DB migration.

## Production gate
State: **BLOCKED**
- Production remains unchanged by this PR.
- There is no Production migration in this track.
- Merge requires exact-head verify/db/browser-smoke Green plus final main/head reconcile and explicit user approval.

## Next action
Re-run exact-head CI after the documentation-only gate correction. If verify, DB/security/RLS and browser smoke are Green, perform final reconcile and present PR #434 for explicit merge approval.

## Mandatory update protocol
- Re-read latest `main` and expected branch HEAD before every repository write.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep this log synchronized with material implementation and verification checkpoints.
- Keep State **BLOCKED** until exact-head CI is Green and explicit merge approval is given.
