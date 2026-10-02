# POS OPERATOR LABEL REFRESH — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/pos-operator-label-refresh-20261002`
Current PR: pending
Baseline: `main@e098667c1557d7e87d4b269712f89ee79344cb72`
Last updated: 2026-10-02

## Work status
State: **ACTIVE — CODE ONLY**

## Guardrails
- No direct write to `main`.
- No force push.
- No Production SQL, migration, data mutation, RLS change, function change, trigger change, or index change in this stage.
- Preserve branch isolation and Permission-First.
- Do not modify KDS behavior, `send_to_kitchen`, inventory deduction, FIFO, printing, Print Agent, payments, shifts, or table-state semantics.
- Runtime behavior must remain safe for active Smouha and Cleopatra branches.
- Unexpected HEAD or branch divergence => stop and reconcile before the next write.
- Merge requires exact-head Full Verify Green and explicit user approval.

## Baseline
- Production audit found `get_pos_order_operator_labels` is a high-frequency POS read.
- Historical PostgreSQL stats show more than 43k calls since stats reset; recent edge logs show more than 2k requests in the sampled window.
- The RPC itself is branch-scoped and permission-guarded; the issue is request amplification, not authorization correctness.
- Prior zero-idle/runtime work is already merged; this stage targets active POS refresh amplification only.

## Objective
Reduce unnecessary `get_pos_order_operator_labels` calls without changing visible operator labels or POS correctness:
1. keep operator labels authoritative for active open/held orders;
2. avoid refetching them when the active-order identity/cashier set has not changed;
3. preserve refresh after relevant order/cashier changes;
4. add regression coverage for the cache/invalidation contract;
5. keep the implementation frontend/service-only.

## Verification ledger
- Branch created from exact current main: complete.
- Source audit: pending.
- Unit regression: pending.
- Typecheck/lint: pending.
- Full Verify: pending.
- Production change: none.

## Production gate
State: **BLOCKED**
- No Production database change is planned in this stage.
- No merge until Full Verify Green + explicit approval.

## Next action
1. Inspect the current POS active-order snapshot and Realtime invalidation flow.
2. Implement the smallest safe operator-label request suppression.
3. Add tests.
4. Run verification.
5. Open PR for review; do not merge.
