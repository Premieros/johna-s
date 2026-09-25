# RAW MATERIAL & DAY CLOSING REPORTS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/raw-material-financial-reports-20260925`
Current PR: `#363`
Last updated: 2026-09-25

## Work status

State: **BLOCKED**

Implementation is complete on the development branch. Merge and Production migration remain blocked until exact-head Full Verify is green and explicit approval is given.

## Guardrails

- Single Writer only.
- No direct writes to `main`.
- No force push.
- No Production migration before exact-head Full Verify Green + explicit approval.
- Printing / Print Agent / KDS / shifts are out of scope and untouched.
- Permission-First and branch isolation remain enforced.
- Unexpected HEAD = STOP_AND_RECONCILE.

## Baseline

- Base main: `7900e15a0d6bddecb630e3316a446bd3367332fb`.
- Reporting sources already present:
  - `inventory_ledger` for authoritative inventory movements / actual consumption value.
  - `raw_material_batches` for residual FIFO stock valuation.
  - `get_day_closing_report` for authoritative business-day closing and payment-method split.

## Root-cause ledger

1. Existing reports used multiple data paths, which could produce inconsistent values for the same business metric.
2. Raw-material period movement needed explicit opening, purchases, consumption, and closing quantities/values.
3. Current raw-material valuation needed residual FIFO batch value rather than a guessed/latest purchase price.
4. Monthly/day-range closing needed the same source as day closing, not a separate recomputation.
5. CI active-worklog gate still pointed at an older FIFO work log and blocked verification before lint/typecheck/tests.

## Change ledger

- Added `20260925153500_raw_material_financial_reports.sql`.
- Added `20260925155500_day_closing_range_report.sql`.
- Added reports:
  - raw material movement / consumption;
  - current raw material FIFO valuation;
  - raw material financial report;
  - daily closing & payment methods for arbitrary date ranges.
- Wired Reports Center, deep links, Excel profiles, filters, and report registry.
- Added unit contract tests for raw-material reports and day-closing range source-of-truth behavior.
- Updated mandatory active work-log gate to this report branch.

## Verification ledger

- PR #363 exact-head verify run `36137790704`: **FAILED at active-worklog gate only**.
- Failure reason: old mandatory log declared branch `development/fifo-opening-repair-final-20260925`, not this PR branch.
- Lint, typecheck, unit tests, build, db, browser-smoke did not run because the gate stopped verification.
- Next verification must run on the new exact HEAD after the gate correction.

## Production gate

State: **BLOCKED**

- Exact-head Full Verify Green: NO.
- Explicit Production approval: NO.
- Production migration: NOT ALLOWED.
- Merge: NOT ALLOWED until verification is green and approval is given.

## Next action

Run Verify main on the exact new HEAD after the active-worklog gate correction. If any later stage fails, fix only the proven failure and rerun.

## Mandatory update protocol

- Before every write, verify branch HEAD against the expected prior commit.
- After each change group, update Change ledger.
- After each verification, update Verification ledger with exact run/result.
- Keep Production gate BLOCKED until exact-head Full Verify is green and explicit approval exists.
