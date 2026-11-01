# Stock count apply atomicity — 2026-11-01

Repository: `Premieros/johna-s`
Production: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-apply-atomicity-20261101`
State: **DRAFT / BLOCKED ON EXACT-HEAD CI AND REVIEW**

## Incident found proactively
Read-only inspection of the live `public.apply_stock_count(uuid)` function showed four early `RETURN jsonb_build_object(success=false,...)` paths inside a nested PL/pgSQL `BEGIN ... EXCEPTION` block. A failed later count item (e.g. insufficient FIFO stock) can return normally **after earlier items have already mutated stock**, committing a partial application while the count remains `approved`. This is a structural atomicity defect, not evidence that a particular customer count has already been partially posted.

## Repair
Migration `20261101082000_atomic_stock_count_apply.sql` retains the existing signature, authorization, accounting, FIFO routing, error payloads and successful application behavior. For each of the four early failure branches, capture the existing error JSON and raise an exception inside the nested block. PostgreSQL rolls back the entire nested block before its handler returns the original structured error. Unexpected exceptions continue to return `TRANSACTION_FAILED`. No data migration, reapplication or automatic stock write.

Integration test `stockCountApplyAtomicity.test.ts` uses a disposable localhost PostgreSQL transaction and rollback. It creates two products: the first count line adds inventory; the second line hits a controlled FIFO shortage. It verifies both inventory balances, batches, ledger, stock transactions, journal and count status remain unchanged. No live test fixtures.

## Safety and release gates
Do not run any mutating SQL on production or alter the approved historical counts #00006/#00007. Verify exact-head CI including DB, unit, browser and migration checks; perform SQL/security review before any merge or migration deployment. This candidate is separate from stock-count operator recovery PR #562 and does not resolve its permission/UI issues. A follow-up should enforce the client-only one-active-count-per-warehouse rule at the database boundary after checking all legacy tests and existing data.

## Verification ledger
- Read-only production function definition inspected 2026-11-01; four premature failure returns confirmed.
- Read-only production audit: two long-approved, unposted counts; no duplicate active counts per warehouse; 30-day sales/purchase totals had no negative total/paid values.
- Exact-head CI pending; no production changes made.

## Next action
Open draft PR, inspect CI failures, repair fixture/SQL if needed, and keep blocked until fully green and reviewed. No auto-merge or deploy.
