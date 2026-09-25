# RAW MATERIAL & DAY CLOSING REPORTS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/cleopatra-v811-final`
Current PR: `#365`
Last updated: 2026-09-25 — Cleopatra V8.1.1 exact-head verification

## Work status

State: **READY_FOR_MERGE_APPROVAL**

Implementation is complete on the development branch. Exact-head Full Verify is green. Merge still requires explicit approval. Production migration remains blocked until a separate explicit approval after merge.

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

- Previous PR #363 run `36137790704`: failed only at stale active-worklog gate before lint/typecheck/tests.
- Active-worklog gate corrected on branch.
- Exact-head Verify main run `36138051390` on `83a0ebdff903944e21e56ce8fcf988d1312bb7ac`: **FULL GREEN**.
- verify ✅
- db ✅
- browser-smoke ✅

## Production gate

State: **BLOCKED**

- Exact-head Full Verify Green: YES — run `36138051390`.
- Explicit merge approval: NO.
- Explicit Production approval: NO.
- Production migration: NOT ALLOWED.
- Merge: READY only after explicit approval.

## Next action

Wait for explicit merge approval for PR #363. After merge, verify main again. Production migration remains a separate gate requiring explicit approval.

## Mandatory update protocol

- Before every write, verify branch HEAD against the expected prior commit.
- After each change group, update Change ledger.
- After each verification, update Verification ledger with exact run/result.
- Keep Production gate BLOCKED until exact-head Full Verify is green and explicit approval exists.


---

## PR #365 checkpoint — Cleopatra Print Agent V8.1.1

- Scope: Cleopatra-only V8.1.1 Lite print agent build.
- Branch ID: `279e6662-e901-40b2-9170-7dda0b471ba7`.
- AppId: `PremierCleopatraFormPrintAgentV0811`.
- Assembly: `PremierCleopatraFormPrintAgentV0811`.
- No Production migration applied.
- Production Realtime wake for Cleopatra is not enabled yet; fallback polling remains active until separate approval.
- Exact-head Build + Full Verify required before artifact handoff.
