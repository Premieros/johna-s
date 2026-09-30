# Emergency Operational Stale-Client Guard — 2026-09-30

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/emergency-stale-client-duplicate-line-guard-20260930`
State: **BLOCKED**

## Work status
- All previously open Draft PRs were closed before this emergency audit.
- Operational audit found printing queues healthy in Smouha and Cleopatra: submitted, attempts=1, no last_error.
- One critical residual was found on Smouha order `Johna's-01525`: a Water line quantity 4 with sent_quantity 1, leaving 3 unsent units at risk of later kitchen dispatch.
- The three unsent duplicate Water units were corrected on the open/unpaid order using the existing sent-item mutation guard context; sent_quantity remained 1 and unsent_qty became 0.
- No payment, settled sale, or historical closed order was altered.

## Guardrails
- Emergency-only scope.
- No direct main edit.
- No force push.
- No RLS/permission weakening.
- No Print Agent/KDS routing change.
- No broad data cleanup.
- Production migration only after exact-head Full Verify Green.

## Baseline
- Main contains PR #421 merge `b9e2238cdafcd5b79d6cea73ce80fe6a6ed680fa`.
- Production already contains `20260930183000_pos_line_identity_resend_guard`.
- New emergency branch created from current main.

## Root-cause ledger
1. New clients preserve `order_item_id`, but a stale cached client can still omit it for all resumed lines.
2. `update_order` legacy fallback matches existing identical lines one-to-one.
3. If stale payload contains one extra identical line after all existing identical rows are already matched, the legacy fallback may insert a new duplicate row.
4. If that order already has kitchen history, the new row can become a fresh kitchen delta and repeat printing.

## Change ledger
- Add server-side containment in `update_order`.
- When `order_item_id` is omitted and no unmatched line remains, if an identical configuration with kitchen-send history already exists, return `STALE_CLIENT_DUPLICATE_LINE` instead of inserting a new row.
- Keep legitimate new configurations, notes, modifiers, prices, and unsent new orders unchanged.

## Verification ledger
- Migration applied inside Production transaction + ROLLBACK: ✅
- Confirmed Smouha corrupted residual corrected: ✅
- Unit contract added: ✅
- Exact-head Full Verify: pending.
- DB integration/security: pending.
- Browser Smoke: pending.
- Production post-deploy operational audit: pending.

## Production gate
Blocked until exact-head Full Verify, DB integration/security, and Browser Smoke are all Green, then merge and apply deliberately to Production.

## Next action
Open the emergency PR, run exact-head Full Verify, merge only if Green, apply the migration to Production, then resume read-only operational checks on both branches.

## Mandatory update protocol
Update this log after each verification, merge, migration, or Production-state change. Keep `State: **BLOCKED**` until the Production gate is complete.
