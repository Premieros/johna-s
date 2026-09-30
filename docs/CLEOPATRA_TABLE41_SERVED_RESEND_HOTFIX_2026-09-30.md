# Cleopatra Table 41 Served-Order Resend Hotfix — 2026-09-30

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/hotfix-cleopatra-table41-served-resend-20260930`
Current PR: `#420`
Last updated: 2026-09-30
State: **BLOCKED**

## Work status
- Production incident confirmed on Cleopatra table 41, order `Johna's-01510`.
- Order is `open / unpaid` while `kitchen_status='served'`.
- Existing sent items are already fully represented in `order_kitchen_sends`.
- New additions after served can be persisted and sent, but the order remains `served`, so KDS omits the new kitchen work.
- Fix is implemented on PR #420 only; Production remains unchanged until verification is Green.

## Guardrails
- No direct write to `main`.
- No force push.
- No weakening RLS, permissions, branch isolation, or Super Admin behavior.
- No change to payment settlement semantics.
- No duplicate stock deduction.
- No replay of previously served items in KDS.
- No Print Agent / receipt / kitchen printer routing changes unless explicitly required by the proven incident.
- No Production migration before exact-head verification passes.
- Runtime safety must hold for both Cleopatra and Smouha.

## Baseline
- Main baseline: `975fa9bfc2ee07f306f5cfd9b46cf04eb1748057`.
- Incident branch: Cleopatra.
- Incident table: 41.
- Incident order: `Johna's-01510`.
- Owner: `ahmud abdelsalam` / username `sosy`.
- Confirmed Production database status: Healthy.

## Root-cause ledger
1. `send_to_kitchen` calculates unsent quantity correctly from cumulative `order_kitchen_sends.sent_quantity`.
2. Its existing state transition only promotes `pending -> sent`.
3. If the order is already `served`, a later successful send leaves the order `served`.
4. `get_kitchen_queue` intentionally excludes `served` orders.
5. Therefore new additions disappear from KDS even though the send ledger/inventory path ran.

## Change ledger
- Add a server-owned per-item served-quantity baseline.
- Record that baseline whenever KDS marks the order `served`.
- If a served order receives a non-zero kitchen delta, reopen it to `sent`.
- KDS quantity becomes cumulative sent minus cumulative served baseline.
- Previously served items remain excluded from the new kitchen cycle.
- Added integration coverage in `tests/integration/kitchen_quantity_delta.test.ts` through the real `send_to_kitchen` RPC.

## Verification ledger
- Root cause reproduced from Production state: ✅
- Production health checked: ✅
- PR #420 mergeability: ✅
- Active worklog gate first run: ❌ stale previous branch reference only.
- Active worklog corrected for PR #420: pending CI rerun.
- Exact-head verify: pending.
- DB integration: pending.
- Browser smoke: pending if required by workflow.
- Production API parity: pending.
- Post-deploy table 41 check: pending.

## Production gate
Production application is blocked until:
- exact-head Verify is Green;
- DB migration checks are Green;
- no regression appears in inventory/KDS/printing boundaries;
- PR #420 is merged;
- migration is applied to Production deliberately;
- table 41 is rechecked after deployment.

## Next action
Run CI on the corrected active worklog head. If Green, merge PR #420, apply the migration to Production, then verify table 41 and confirm only new additions enter KDS.

## Mandatory update protocol
Update this log after every material code, verification, merge, migration, or Production-state change. Keep `State: **BLOCKED**` until every Production gate above is satisfied.
