# ZERO COST DATABASE RUNTIME — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/zero-cost-db-runtime-20260927`
Current PR: `#391`
Base: `main@ff796cac04a3c11416eaf8aa97d9cb71f536ffa6`
Last updated: 2026-09-27 Africa/Cairo

## Work status

State: **BLOCKED**

Progress: Production and current-main read-only audit complete. Implementation starts with frontend/runtime request suppression only. No Production write is authorized.

## Guardrails

Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

- This file is the mandatory execution log.
- Before every repository write, prove the active branch still points to the expected prior commit.
- No direct write to `main`; no force push.
- No Production migration, SQL mutation, feature activation, or data rewrite in this workstream without separate explicit approval after exact-head Full Verify Green.
- Preserve Permission-First, branch isolation, RLS, settlement atomicity, shift/day correctness, and current operational behavior.
- **Printing freeze is absolute for this workstream:** do not modify `cloud_print_jobs`, Print Agent code/config, printer stations, print routing, queue claim/start/complete behavior, payloads, print migrations, or receipt/kitchen print actions.
- **Kitchen freeze is absolute for this workstream:** do not modify KDS behavior, `send_to_kitchen`, kitchen routing/transport, or `order_kitchen_sends` semantics.
- Read-only measurements of frozen paths are allowed only to quantify load.
- Prefer frontend/session cache, in-flight request deduplication, event-driven invalidation, and removal of idle polling before considering database changes.
- Any optimization that could change payment, settlement, stock deduction, printing, or kitchen-send outcomes is rejected from this branch.

## Baseline

- Current main at branch creation: `ff796cac04a3c11416eaf8aa97d9cb71f536ffa6` (merged PR #390).
- Production PostgreSQL statistics reset timestamp: `2026-08-25 20:33:23.891825+00`.
- Production database size observed during audit: approximately `128 MB`.
- Production connections observed during audit: 23 total / 2 active at the sampled instant.
- Historical `pg_stat_statements` samples show load dominated by high-frequency runtime calls rather than database size.
- Read-only sample counts since stats reset include:
  - `cloud_print_jobs`: ~1,124,193 calls — frozen, measure only in this branch.
  - `order_kitchen_sends`: ~33,797 calls — frozen, measure only.
  - `get_pos_order_operator_labels`: ~33,515 calls.
  - active `dining_tables` snapshot query shape: ~33,510 calls, plus other table-query shapes.
  - `try_auto_close_branch_shift`: ~15,720 calls.
  - `get_active_shift`: ~12,691 calls.
  - `get_kitchen_queue`: ~11,950 calls — KDS frozen.
- Current code audit confirmed:
  - approval status polling every 2 seconds in `TransferItemModal`.
  - approval status polling every 2 seconds in `TransferOrderModal`.
  - roles refresh polling every 5 minutes in `RolesContext`.
  - POS active-order refresh reloads dining tables, active orders, operator labels, order items and kitchen-send rows as a bundle.
- Historical performance branches `development/navigation-pos-performance-20260925` and `development/performance-rootfix-20260924` are fully behind current `main` with zero unique commits and are not executable.

## Root-cause ledger

- The main avoidable cost pattern is **idle or event-amplified refetching**, not data volume.
- Some UI flows poll authoritative state on timers even though state changes are sparse.
- Some Realtime-driven POS refreshes invalidate a whole branch snapshot and then re-read multiple tables/RPCs even when one entity changed.
- Static/semi-static data such as roles is periodically refetched despite changing rarely.
- Frozen print polling is the single largest historical query source, but it is intentionally excluded from implementation in this branch to protect live printing.
- ZERO COST in this workstream means **near-zero database reads while the UI is idle**, not zero reads during real operational actions.

## Change ledger

- Created isolated branch `development/zero-cost-db-runtime-20260927` from exact current `main`.
- No Production write performed.
- Draft PR #391 opened from the isolated branch.
- No application/runtime change committed yet.
- Replaced 2-second approval polling in `TransferItemModal` with an ID-filtered `approval_requests` Realtime UPDATE subscription plus one post-subscribe status read.
- Replaced 2-second approval polling in `TransferOrderModal` with the same event-driven pattern.
- Added event-only recovery reads on browser `online` and visible-tab return; there is no periodic fallback timer.
- Preserved the existing authoritative `performOrderAction` retry-after-approval behavior and terminal-state handling.
- Frozen print/KDS paths remain untouched.

## Verification ledger

- Repository identity confirmed: `Premieros/johna-s`.
- Production project confirmed: `azzdesuowpdcoflmyezn`.
- Current `main` confirmed at `ff796cac04a3c11416eaf8aa97d9cb71f536ffa6` before branch creation.
- Existing performance branches reconciled as stale/fully-behind current main.
- Production statistics/read-only SQL audit completed.
- Performance advisor audit completed read-only; no advisor-driven DDL is authorized in this stage.
- Focused tests: pending after Stage 1 source-contract coverage.
- Full Verify: pending.
- Production runtime before/after measurement: pending implementation.

## Production gate

State: **BLOCKED**

- No Production SQL write is authorized.
- No migration is planned for the first implementation stages.
- Merge is blocked until exact-head Full Verify Green and explicit user approval.
- Production application/runtime deployment remains blocked until merge approval.
- Printing/KDS changes are out of scope even after merge unless separately requested.

## Next action

1. Point `docs/CURRENT_WORK_PLAN.md` mandatory execution gate to this branch/log.
2. Implement the first low-risk stage:
   - remove 2-second approval polling using narrowly-scoped event-driven updates or an existing approval-state channel;
   - remove idle role polling while preserving explicit refresh after role mutations and safe authorization behavior;
   - add regression contracts proving no print/KDS files or semantics changed.
4. Run focused unit/type verification.
5. Only after Stage 1 is green, inspect and reduce POS whole-snapshot refetch amplification without touching `order_kitchen_sends` semantics.

## Mandatory update protocol

- Verify active branch HEAD against the expected prior commit before every repository write.
- Update Change ledger after each logical implementation group.
- Update Verification ledger after every test/CI run with the actual result and Run ID when available.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while this workstream is active.
- Do not merge or apply any Production migration until exact-head Full Verify Green and explicit approval.
- If any change unexpectedly reaches printing, Print Agent, print routing/queue/payload, KDS, kitchen transport, or send-to-kitchen paths: stop and revert that change before continuing.
