# Stock count operator recovery — 2026-11-01
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-operator-activation-20261101`
Current PR: #562
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
User reported that an operator cannot perform stock count. Read-only live investigation confirmed `branch_manager` is an active role used by 4 users, has `inventory.view` but not `inventory.count.create`; the client hides New Count without that permission and the RPC also requires it. Existing count `Johna's-00006` (Smouha) and `Johna's-00007` (Cleopatra) remain approved and **not applied** since 2026-10-01. Both hold ~400 lines and block new counts for their warehouses. Neither produced stock journal/ledger/unit/stock-transaction rows.

## Guardrails
Do not automatically apply these old approved counts: the quantities are stale and applying them may change live stock across hundreds of materials. Do not automatically reject any real count either. Grant branch managers only creation/submission; keep approve/reject/apply distinct and privileged. No fake count in production, no historical data deletion. Restrict cancellation of an approved count to users with inventory.count.apply and branch access, and only if no inventory/accounting posting exists; preserve original approver/time and require reason.

## Baseline
Main merge `1f37c815ad2b31c1b80fb623c74aee9d0041a142` (inactive raw cost v2 source only). Existing `reject_stock_count` permits only submitted counts, the frontend blocks creation while old approved counts remain. Existing `create_stock_count` checks inventory.count.create and warehouse/branch access. Existing `apply_stock_count` posts stock and journal and requires distinct inventory.count.apply; no bypass intended.

## Root-cause ledger
- 4 active `branch_manager` users lack count create permission; role has inventory view. Actual user identity/error unconfirmed, so this is a demonstrated role-level defect, not yet proof that the reporting operator had that role.
- Two long-approved counts obstruct new creation in both warehouses; the UI needs clear stale-count explanation and an authorized cancellation path without inventory adjustment.
- Other roles intentionally retain separate controls. Do not grant blanket financial apply authority to branch managers.
- Actual apply RPC may have separate accounting/FIFO behavior and old-count age risks, which are not fixed by role gating alone.

## Change ledger
- `supabase/migrations/20261101071500_restore_stock_count_operator_and_safe_cancel.sql`: grant `inventory.count.create` only to active, inventory-view-enabled `branch_manager`; extend `reject_stock_count(uuid,text)` for unposted approved count cancellation with reason, branch/access, `inventory.count.apply` privilege and no prior stock/journal entries. Preserve original approver metadata; leave submitted rejection permission and application untouched.
- `src/features/inventory/pages/StockCountsPage.tsx`: explain blocking approved counts, let authorized count-apply users explicitly cancel an unposted approved count (reason required), leave financial apply a separate button and permission.
- `tests/integration/stockCountBranchManagerRecovery.test.ts`: three tiny tests inside CI's disposable PostgreSQL transaction and ROLLBACK; no production data changes.
- No schema change beyond existing role JSON and RPC replacement, no new table, no expanded unrelated role permissions.

## Verification ledger
Read-only live production query found 4 stock counts total: #00006 and #00007 approved, #00005 rejected, historic Smouha opening applied. The two pending approved counts have 401 and 402 lines and zero referenced `inventory_ledger`, `inventory_unit_entries`, `stock_transactions`, `journal_entries`. Role matrix verified active managers lack create; no role grants were changed in production. CI exact-head pending.

## Production gate
**BLOCKED** pending integration test, unit/type/lint and browser checks, and controlled authorization/security review. A checked migration may be deployed only after green CI; never apply or reject real stock counts without a human choosing a specific document and cause. Older approved count application must be reviewed for staleness before any stock movement.

## Next action
Run exact-head CI; repair any integration errors; release only permission/RPC + frontend fix through reviewed migrations/deployment, verify grants and function. Owner/operator then explicitly cancels stale #00006/#00007 if intended; never auto-act.

## Mandatory update protocol
Update this active worklog after every substantive change/CI outcome. CI must fail if incomplete. No Merge or Production migration before the relevant release gate. Preserve accounting and inventory.
