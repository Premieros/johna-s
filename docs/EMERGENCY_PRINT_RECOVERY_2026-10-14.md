# Emergency print recovery — 2026-10-14
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/print-wake-reconcile-20261014`
Current PR: #505
Last updated: 2026-10-14 21:46 Cairo

## Work status
State: **BLOCKED** pending exact-head verification of the web queue fallback and production publication. Two targeted production read indexes were separately applied and verified; runtime code is not yet merged. This is an urgent, narrowly scoped fix, not a complete kitchen-send or physical-print closure.

## Guardrails
No Windows print executable/service or printer configuration changes. No live test orders, requeues or physical printer tests. Preserve per-branch agent identity, print idempotency, receipts, all stock/FIFO/accounting functions, RLS and security. Do not change kitchen send SQL speculatively.

## Baseline
main `8fffc3d3` (#503). Supabase project `azzdesuowpdcoflmyezn`. Observed Smoha bar print jobs p95 queue-to-claim approximately 11.06s (claim-to-submit ~1.16s); Cleopatra bar p95 claim ~2.19s. This does not measure actual paper. In 24h PostgreSQL logs, 6 `send_to_kitchen` timeouts and 7 `get_open_order_print_state` timeouts. Two Cleopatra sends lacked matching cloud kitchen jobs; local fallback may have printed, so they are not proof of paper failure.

## Root-cause ledger
1. `get_open_order_print_state` checked a receipt `LIKE 'open-check:<uuid>:%'` prefix but used a branch-only queue index, scanning unrelated jobs. Cost estimate 2736.88 before index.
2. Print alert/failed retry reads similarly scanned branch-level jobs before the filter. Cost estimate 2807.72.
3. The web agent used Realtime wake plus a 60s subscribed-state reconciliation; a missed event can leave a cloud job unclaimed. This is a resilience correction, not proof of the cause of every Smoha delay.
4. Kitchen send SQL timeouts occur in different inventory components and must not be dismissed or fixed by unsafe function rewrites.

## Change ledger
- Production migration `20261014184308_emergency_receipt_open_check_pattern_index_20261014`: partial receipt prefix lookup index only; applied with 1.5s lock and 15s statement timeouts.
- Production migration `20261014184418_emergency_print_alert_read_index_20261014`: partial recent-alert index only; same bounded lock/statement constraints.
- Web source: subscribed print agent reconciliation 60s to 5s with existing Realtime wake and queue claim/ack untouched.
- POS kitchen send source: one 250ms-delayed retry only for `rpc.error.code === '57014'`, which proves the PostgreSQL transaction was aborted; never retry unknown transport/commit outcomes. Existing authoritative inventory/send/print RPCs unchanged.
- Focused wake source contract updated and three short behavioral kitchen RPC retry tests added (success on second attempt, unknown network failure no retry, repeated 57014 stops after one retry). Retain automatic browser / DB CI gates; no new bespoke long performance tests.

## Verification ledger
Production indexes exist; post-index EXPLAIN selects `idx_cloud_print_receipt_open_check_lookup` (estimated total cost 2.51) and `idx_cloud_print_alerts_recent` (cost 3.22). No live paper or post-index production p95 guarantee. CI must validate exact updated head; a first attempt failed only because the previous active branch was still declared in the work plan.

## Production gate
State: **BLOCKED** pending exact-head CI and merge/deploy. The two index migrations were applied successfully directly in the selected production project, then verified read-only. No kitchen/inventory DDL, Windows changes or manual replays. Owner requested urgent repair and shorter tests; do not weaken mandatory correctness checks.

## Next action
Update mandatory active branch reference, verify focused source and exact-head CI; publish web fix if green. Review remaining kitchen-send timeouts independently (client bounded retry is mitigation, not permanent SQL performance fix), and obtain real-device evidence only if paper is still absent. Do not automatically replay historical kitchen tickets.

## Mandatory update protocol
Single writer. Confirm main/branch before merge; no direct main writes or force pushes. Keep applied migration versions in sync with canonical history. Stop on unexpected schema or main drift; never replace production order, FIFO or accounting records.
