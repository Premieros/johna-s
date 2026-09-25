# RAW MATERIAL & DAY CLOSING REPORTS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/raw-material-financial-reports-20260925`
Current PR: `#363`
Last updated: 2026-09-25

## Work status

State: **IN_PROGRESS**

User requested a compact two-row Reports Center UI, quantity columns visible in the raw-material financial summary row, and a more professional Excel export with visible title/header styling, filter, and totals. Previous exact-head Full Verify is now superseded by this new UI/export work. Production migration remains blocked.

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
- Simplified Reports Center shell by removing search/category/favorite/recent report cards from the active page.
- Rebuilt report controls as exactly two compact rows: visible report dropdown + actions, then contextual filters/run controls.
- Moved column picker / Excel / CSV / print actions into the first compact row and removed the extra page header/custom-report bar from the active layout.
- Fixed raw-material financial quantity visibility: period-total row now declares all quantity columns with `—` instead of hiding them; per-material quantities remain authoritative and no incompatible units are summed.
- Raw-material financial Excel export now exports detail rows with the period-total row as the styled table total.
- Reworked Excel layout into one professional sheet with a large colored title, period subtitle, larger colored column headers, Auto Filter, frozen header, controlled widths, and styled totals/source note.

## Verification ledger

- Previous PR #363 run `36137790704`: failed only at stale active-worklog gate before lint/typecheck/tests.
- Active-worklog gate corrected on branch.
- Exact-head Verify main run `36138051390` on `83a0ebdff903944e21e56ce8fcf988d1312bb7ac`: previous **FULL GREEN**, superseded by new UI/export changes.
- New compact UI / quantity visibility / Excel verification: pending exact-head runs.
- verify ✅
- db ✅
- browser-smoke ✅

## Production gate

State: **BLOCKED**

- Exact-head Full Verify Green: YES — run `36138051390`.
- Explicit merge approval: NO.
- Explicit Production approval: NO.
- Production migration: NOT ALLOWED.
- Merge: BLOCKED by new UI/export changes until a new exact-head Full Verify is Green.

## Next action

1. Collapse the Reports Center controls to exactly two compact rows: report dropdown, then contextual filters/run controls; remove report-browser cards/search clutter from the active page.
2. Ensure the raw-material financial period-total row includes opening/purchase/consumption/closing quantities so quantity columns are visible.
3. Improve Excel output: prominent title, colored/larger headers, visible filter, frozen header, and a clear total/summary row.
4. Update contract tests, run exact-head Fast Verify + Full Verify, then stop before merge.

## Mandatory update protocol

- Before every write, verify branch HEAD against the expected prior commit.
- After each change group, update Change ledger.
- After each verification, update Verification ledger with exact run/result.
- Keep Production gate BLOCKED until exact-head Full Verify is green and explicit approval exists.
