# Quick-order access — 2026-10-24

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/quick-order-discoverability-20261024`
Current PR: #535
Last updated: 2026-10-24 (Africa/Cairo)

## Work status
State: **BLOCKED**
Owner approved merge/publication. Await exact-head CI success before release.

## Guardrails
No database writes, schema/RLS changes, action-permission expansion, customer orders, print-agent changes or kitchen RPC changes. Preserve #534 partial-transfer repair.

## Baseline
Released main `15b762a1fad42dafc5510b5bbc50fef3d1b84022`.

## Root-cause ledger
- Quick creation is independently granted by `pos.order.quick_create`. Kitchen send correctly requires `pos.send_kitchen`; the UI hid the action without explanation.
- Quick orders are accessible through the general active-orders drawer, but lack a direct persistent shortcut.

## Change ledger
- Persistent open-quick-orders shortcut shows the existing live takeaway count and opens the existing quick filter without resetting the current order.
- For quick-order creators lacking kitchen-send permission, show a disabled action and explain the required permission. Do not infer kitchen access from creation access.
- No additional network reads, polling, API contract changes or database changes.

## Verification ledger
- 8 focused component/permission tests passed; application typecheck, targeted ESLint and diff whitespace check passed.
- Initial remote head: DB regression, browser smoke and Pages continuity passed. Verify stopped at work-log branch mismatch; corrected by this documentation update, without weakening the gate.
- Exact final-head full Verify and postmerge deployment must be recorded in the PR release ledger before claiming completion.

## Production gate
Owner explicitly approved #535 merge/publication in this conversation. Merge only the approved UI scope after exact-head required checks succeed. No production migration is required or authorized by this PR.

## Next action
Verify corrected-head CI; mark ready, merge with expected-head guard, check main and Pages, and read back the public built assets. Keep installation permissions separate: a cashier who dispatches needs `pos.send_kitchen` enabled by an authorized administrator.

## Mandatory update protocol
Record findings, changes and checks here before advancing. Record final CI IDs and deployment evidence in the PR release ledger; do not claim paper output or live cashier acceptance without observing it. Rollback is a normal revert of the UI/documentation commits; no data rollback.
