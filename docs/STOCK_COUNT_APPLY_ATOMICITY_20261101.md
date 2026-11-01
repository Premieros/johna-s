# Stock count apply atomicity — 2026-11-01
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-apply-atomicity-20261101`
Current PR: #565
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
Draft candidate to repair a proactively discovered stock-count partial-posting defect. No merge, no production migration and no production stock movement. Exact-head CI pending.

## Guardrails
Preserve authorization, all existing financial/stock writes on success, FIFO/accounting behavior, historical documents and error payloads. All test writes are inside a disposable localhost PostgreSQL transaction and rolled back. Do not automatically apply or cancel the live historical counts #00006/#00007.

## Baseline
Read-only production inspection of `public.apply_stock_count(uuid)` showed four early `RETURN jsonb_build_object(success=false,...)` paths inside a nested PL/pgSQL `BEGIN ... EXCEPTION` block. If an earlier count item changed stock and a later item hit a FIFO shortage or add failure, returning normally could commit earlier stock changes while the count remained `approved`. This is a proven code-path atomicity defect, not evidence that an actual customer document was partially posted.

## Root-cause ledger
- Four normal early error returns skip subtransaction rollback: `RAW_ADJUST_FAILED`, two `STOCK_COUNT_SHORTAGE` branches, and `ADJUST_FAILED`.
- `apply_stock_count` holds the document row lock, but a normal JSON return is not a PostgreSQL exception; the earlier inventory writes can commit.
- Client-only protection against multiple active counts per warehouse has no matching unique partial index. This is a separate structural follow-up; production read-only query found no existing duplicate active counts.

## Change ledger
- `supabase/migrations/20261101082000_atomic_stock_count_apply.sql`: retain the function signature, security definer, permissions, existing posting and accounting logic. Capture the same structured failure JSON in `v_failure` and raise inside the nested block on each of the four early exits. The exception handler returns the captured error only after PostgreSQL rolls back all previous line writes. Unexpected errors retain `TRANSACTION_FAILED`.
- `tests/integration/stockCountApplyAtomicity.test.ts`: create two disposable products, with the first count line adding inventory and the second encountering a controlled FIFO shortage; assert zero leaked inventory, batches, ledger, stock transactions and journals, and an unchanged approved count. No production test rows.
- `tests/integration/kitchenCanonicalCommittedConcurrency.test.ts`: in its separately created disposable `qa_kitchen_*` database only, restore the October-13 historical apply-count body from the immutable rollback review package before testing the historical rollout. Keep the rollout's exact hash/ACL/search-path fail-closed drift guard intact; never relax production guard checks.
- `docs/CURRENT_WORK_PLAN.md`: declare this branch and mandatory work log.

## Verification ledger
Read-only production function definition inspected 2026-11-01; all four premature returns identified and replaced in candidate SQL. Read-only production audit found two approved, unposted counts; no duplicate active count per warehouse; last 30 days sales/purchase totals had no negative total or paid values. First exact-head CI: pages continuity, browser smoke and app/unit verification passed; DB failed on a mixed UUID/text parameter in the new disposable fixture and on the *expected* historical kitchen rollout hash guard detecting the new function. Fixture parameter fixed; historical rollout test now restores its pinned old function in its own throwaway database before rehearsal, without weakening guard. Re-run pending. No production changes.

## Production gate
**BLOCKED** until exact-head GitHub Actions DB integration/security, unit/type/lint, browser smoke and pages continuity pass and SQL/security review is complete. This PR is separate from operator recovery PR #562 and does not solve the missing count-create role permission. Never deploy an untested migration, change real stock, or auto-merge.

## Next action
Check CI failures and repair the fixture or SQL if needed; require green exact-head checks and review before any release. Track a distinct follow-up to enforce one active count per warehouse at the database boundary without breaking historical tests.

## Mandatory update protocol
Update this work log after each substantive change or CI result. CI must fail when the mandatory log is missing or incomplete. No Merge or Production migration before release gates; preserve all accounting and inventory.
