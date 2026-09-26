# POS TABLE ORDER BINDING HOTFIX — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/pos-table-order-binding-hotfix-20260926`
Current PR: `#384`
Last updated: 2026-09-26 Africa/Cairo

## Work status

State: **BLOCKED**

Goal: prevent active dine-in orders from being silently detached from their table during ordinary POS saves, and remove the transient table/order mismatch that can delay or hide orders on the floor plan.

## Guardrails

- Start from latest merged `main@8cd21d8dce34712f897f06e088eec70dc38a1956`.
- Independent hotfix branch only; do not write to PR #383 or its branch.
- No direct write to `main`; no force push.
- Printing / Print Agent / routing / KDS / send-to-kitchen transport remain frozen and untouched.
- No inventory, kitchen-send snapshot, settlement math, or payment history rewrite.
- Preserve Permission-First and branch isolation.
- No Production migration before exact-head Full Verify Green and explicit approval.
- Production data repair for Table 48 / Johna's-01020 is already completed separately and is not part of this code-change branch.

## Baseline

- Main head at branch creation: `8cd21d8dce34712f897f06e088eec70dc38a1956`.
- Production incident: Smouha Table 48 became `vacant` while an open, unpaid, kitchen-sent order remained alive with `table_id = NULL` and `order_type = takeaway`.
- The affected order was restored to Table 48 without resending to kitchen, reprinting, or inventory mutation.
- Production logs show authenticated user `96aac7a0-a574-41a3-8a31-4e5c095d04ec` issued `update_order` twice at 2026-09-26 14:37:06Z and 14:37:11Z; no `detach_order` call occurred in that window.

## Root-cause ledger

1. `usePosOrderBase.persistCart` derives `p_table_id` from transient client state: `orderType === 'dine_in' ? tableId : null`.
2. `saveOpenOrderSnapshot` and settlement paths repeat the same derivation.
3. `public.update_order` accepts a live table-bound order changing to `p_table_id = NULL` and then frees the old table automatically.
4. Therefore an accidental/stale client `orderType = takeaway` during an ordinary save can silently detach the order and mark the table vacant.
5. The floor plan then legitimately stops showing the order because active table rendering keys off `orders.table_id = dining_tables.id`; this can look like delayed/missing table orders.
6. The server currently cannot distinguish an ordinary save from an intentional detach, although an explicit `detach_order` RPC already exists for that purpose.

## Change ledger

- Isolated branch created from exact latest main.
- No runtime changes written yet.
- Implemented repair group prepared: ordinary `update_order` will reject implicit table detach and table-bound non-dine-in saves; explicit `detach_order` remains supported. Frontend ordinary-save paths now preserve a known active table binding through a shared resolver. Regression coverage added for transient UI drift and server-side detach/type rejection.

## Verification ledger

- Production incident correlation verified read-only from current DB/logs.
- Code change group written; focused verification pending on the new exact head.

## Production gate

State: **BLOCKED**

- No Production migration applied.
- Merge blocked until exact-head Full Verify Green and explicit approval.
- Any database function replacement must be forward-only in a new migration.

## Next action

Run focused unit/integration contract checks for the binding resolver and `update_order`, then run Fast Verify. If focused checks are Green, run exact-head Full Verify before any merge or Production migration.

## Mandatory update protocol

- Before every repository write, verify current hotfix branch HEAD and current `main`.
- Unexpected movement = STOP_AND_RECONCILE.
- Record each logical change group in `Change ledger`.
- Record every verification run/result in `Verification ledger`.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this log while this hotfix PR is active.
- Do not merge or apply a Production migration until exact-head Full Verify is Green and explicit approval is recorded.
