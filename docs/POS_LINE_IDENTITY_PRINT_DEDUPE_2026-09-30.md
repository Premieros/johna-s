# Emergency POS Line Identity / Print Dedupe — 2026-09-30

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/emergency-pos-line-identity-print-dedupe-20260930`
Current PR: `#421`
Last updated: 2026-09-30 18:35 Africa/Cairo
State: **BLOCKED**

## Work status
- Critical live incident active in Smouha and Cleopatra.
- Smouha evidence: Johna's-01525 / Table 50 produced oversized/repeated Water kitchen deltas.
- Cleopatra evidence: repeated/garbled checks, cashier-print complaints, table 41 stuck.
- Code fix and DB migration are implemented on PR #421.
- Production migration is not yet applied.
- Exact Production transaction/rollback verification on the affected Smouha order proved one exact +1 line produces one delta line only.

## Guardrails
- No direct write to main.
- No force push.
- No weakening RLS, branch isolation, permissions, or inventory guards.
- No automatic live rewrite of existing affected quantities.
- No manual replay of kitchen tickets.
- Print Agent routing stays unchanged.
- Production migration only after exact-head Verify is Green.

## Baseline
- Main baseline: `c1c0b4a72a8cf3a3e233a66f2d15081a931de12e`.
- Active branch: `development/emergency-pos-line-identity-print-dedupe-20260930`.
- PR: #421.
- Affected Smouha order: `Johna's-01525`.
- Affected Cleopatra order/table reference: `Johna's-01510` / table 41.

## Root-cause ledger
1. Resumed cart rows carry `order_item_id`.
2. A newly selected identical product does not carry that ID.
3. `addToCart` compared `cartLineKey`, which uses `order_item_id` for resumed lines, so an identical addition could become a second line instead of incrementing the persisted line.
4. `cartToItems` dropped `order_item_id`, so `update_order` had no stable persisted identity.
5. With identical lines, fallback configuration matching could map quantities to the wrong persisted row, producing false kitchen deltas and repeated/oversized tickets.
6. Production evidence on Smouha Johna's-01525 shows two Water rows, both quantity 4 / sent 4, confirming persisted duplicate-line drift.

## Change ledger
- Carry `order_item_id` in the POS cart payload.
- Merge a fresh identical addition into the existing resumed business configuration.
- Patch `update_order` to prefer exact persisted `order_item_id`.
- Return `ORDER_ITEM_IDENTITY_MISMATCH` rather than silently swapping a line.
- Include unit price and normalized modifier identity in legacy fallback matching.
- Preserve existing `send_to_kitchen`, KDS, inventory, and cloud-print idempotency behavior.
- Added a unit contract that locks the resumed-line identity behavior.

## Verification ledger
- Production migration parse/apply under BEGIN/ROLLBACK: ✅
- Exact affected-order simulation under BEGIN/ROLLBACK: ✅
  - incremented one specific Water line by +1;
  - `update_order` succeeded;
  - `send_to_kitchen` reported exactly one sent delta line;
  - target cumulative sent moved 4 -> 5;
  - other identical Water row remained 4.
- First CI run: ❌ worklog structure only; code/tests were skipped.
- Worklog structure corrected: ✅
- Exact-head Verify rerun: pending.
- Production apply: pending.
- Post-deploy live read-only verification: pending.

## Production gate
Do not apply the migration or merge until:
- exact-head Verify is Green;
- DB integration/security is Green;
- Browser Smoke is Green;
- PR #421 remains mergeable;
- main has not drifted unexpectedly.
After Green:
- merge PR #421;
- apply migration to Production;
- verify new Smouha/Cleopatra updates preserve exact line identity and emit only true deltas;
- verify cloud print queue has no duplicate idempotency keys or false kitchen quantities.

## Next action
Rerun Verify on the corrected worklog head. If Green, merge PR #421 and apply `20260930183000_pos_line_identity_resend_guard.sql` to Production immediately.

## Mandatory update protocol
Update this log after every material code, CI, merge, migration, or Production verification change. Keep `State: **BLOCKED**` until the Production gate is complete.
