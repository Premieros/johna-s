# Treasury / Day-Close Reconciliation — 2026-09-26

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/treasury-daily-close-reconciliation-20260926`
Current PR: `#380`
Last updated: 2026-09-26 13:50 Africa/Cairo

## Work status

State: **BLOCKED**

Implementation is on a dedicated development branch and PR #380 is Draft.
Production migration is not applied. Merge and Production migration remain blocked pending exact-head Full Verify Green and explicit user approval.

## Guardrails

- Scope is treasury and day-close reconciliation only.
- Do not touch printing, Print Agent, routing, KDS, or send-to-kitchen.
- Do not modify `main` directly and do not force push.
- Do not weaken Permission-First, branch isolation, RLS, or tests.
- No Production migration before exact-head Full Verify Green + explicit approval.
- PR #379 is already merged and is not modified by this work.

## Baseline

- Started from `main@35aabb5643a27f4e93cf3de7ad6e92016071e809`, which includes merged PR #379.
- Production inspection was read-only.
- Latest closed business date observed for both active branches: `2026-09-25`.
- Cleopatra close total was lower than current by post-close journal activity; no post-close `treasury_transactions` transfer explained the difference at inspection time.
- Smouha showed the same pattern: the difference was caused by journaled expenses/sales after the close, not by a treasury transfer record.

## Root-cause ledger

1. The treasury page already receives `expenses` and `cash_purchases` from the immutable day-close snapshot, but it did not display them.
2. `get_branch_treasury_day_close_reconciliation` returned balances at close and deltas between closes, but did not expose the actual journal movements after each close.
3. The existing RPC used `daily_closes.created_at` as the close timestamp; the canonical boundary is `COALESCE(closed_at, created_at)`.
4. Users could see a historical close balance and a different current treasury balance without a source-by-source explanation.

## Change ledger

- Added migration `20260926133500_treasury_day_close_movement_reconciliation.sql`.
  - Preserves existing auth/branch/permission checks.
  - Uses the real close timestamp.
  - For each close, reconciles movements until the next close; the latest close reconciles through current time.
  - Returns cash/bank/net effect per journal entry with reference metadata.
  - Returns balance at close, movement after close, and balance after movement.
  - Keeps empty movement windows as `[]`.
- Updated `src/api/domains/accounting.ts` with the expanded RPC contract.
- Updated `src/features/accounting/pages/TreasuryPage.tsx`.
  - Shows cash/card/credit sales, expenses, cash purchases, close balance.
  - Shows every post-close movement as a separate row with a Details action.
  - Shows cash/bank/net effect and the balance after movement.
  - Marks the latest row as the current treasury balance.
  - Day-close Details calls the existing `get_day_closing_report` source; no duplicate report is created.
- No printing/KDS/Print Agent/routing file changed.

## Verification ledger

- Read-only Production reconciliation query validated the accounting arithmetic against journal entries for both active branches.
- Verified `get_day_closing_report` returns the stored immutable snapshot for a closed business day.
- Git compare versus `main`: branch is ahead only, behind by 0.
- Functional changed files before mandatory log update: accounting API, Treasury page, one migration only.
- PR #380 opened as Draft.
- Full Verify run: `36236595259` — currently running/pending final result.

## Production gate

- Exact-head Full Verify Green: **PENDING**
- User merge approval: **NOT YET GIVEN**
- Production migration approval: **NOT YET GIVEN**
- Production migration applied: **NO**
- Merge allowed: **NO**
- Production migration allowed: **NO**

## Next action

Wait for the new exact-head Full Verify run after commit `70d944d187447f03f09e9767167677130a1580e9`. If any job fails, fix only the treasury/day-close scope on this branch and re-run verification. If Full Verify is Green, report readiness and stop before merge/Production migration for explicit approval.

## Mandatory update protocol

- Before every repository write, confirm the branch still matches the expected head.
- After code changes, update the Change ledger.
- After tests or CI, update the Verification ledger with the exact run/result.
- Keep State **BLOCKED** until exact-head Full Verify is Green and explicit approval is recorded.
- Never merge or apply the Production migration from this log without both gates.
