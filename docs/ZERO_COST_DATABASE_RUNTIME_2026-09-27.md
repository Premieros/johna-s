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
- Replaced 2-second approval polling in `TransferItemModal` with an ID-filtered `approval_requests` Realtime UPDATE subscription plus one post-subscribe status read.
- Replaced 2-second approval polling in `TransferOrderModal` with the same event-driven pattern.
- Added event-only recovery reads on browser `online` and visible-tab return; there is no periodic fallback timer.
- Preserved the existing authoritative `performOrderAction` retry-after-approval behavior and terminal-state handling.
- Removed 5-minute `roles` table polling from `RolesContext`.
- Roles still load at authenticated-session start and refresh after local role create/update/delete; remote-session recovery now occurs only on focus/online/visible-tab events and is throttled to at most once per minute.
- Backend/RLS/RPC authorization remains authoritative if UI role metadata is temporarily stale.
- Updated `rolesRefreshStabilityContract.test.ts` to require event-driven zero-idle role refresh.
- Added `zeroCostIdlePollingContract.test.ts` covering both approval flows, recovery events, absence of timers, and frozen print/kitchen exclusions.
- Stage 2 implemented a single active-shift read for the POS workspace:
  - `PosWorkspacePage` remains the authoritative workspace `getActiveShift` caller.
  - `ProductBrowser` now receives `shiftChecked` and `shiftOpen` from the parent instead of issuing a second RPC.
  - add-to-cart shift blocking semantics are unchanged.
  - `payment.ts` authoritative `getActiveShift` fallback for missing `p_shift_id` is unchanged.
- Added `posSingleShiftReadContract.test.ts` to lock the parent-owned shift read, preserve settlement validation, and exclude frozen printing/kitchen paths.
- Corrected Stage 2 lint regression by removing the obsolete local `branchId` from `ProductBrowser`; no behavior changed.
- Stage 3 implemented POS-route shell read suppression:
  - `Layout` detects `/pos` and nested POS routes and passes `enabled=false` to `useActiveOrderCount`.
  - `useActiveOrderCount` remains mounted unconditionally, retains cached badge data locally, but performs no initial refresh, debounce timer, or Realtime subscription while disabled.
  - Non-POS routes retain the existing lightweight `orders + order_items` badge behavior.
  - POS `useActiveOrders` and its operational realtime snapshot are unchanged.
- Updated `performanceLightweightShellContract.test.ts` and added `posShellDuplicateReadSuppressionContract.test.ts`.
- Main-vs-branch changed-file audit contains no print-agent, cloud-print, KDS, kitchen transport, or migration files.
- Stage 4 simplified the POS product catalog read:
  - `PosWorkspacePage` product query now selects `products.*` only instead of embedding `category:categories(*)`.
  - branch scoping, `is_active=true`, ordering, `category_id`, separate categories query, online-to-offline cache writes, and all product fields are preserved.
  - no cache TTL/freshness behavior was changed.
- Updated `productsPosCatalogContract.test.ts` to require the lean product query and the separate categories source.
- Main-vs-branch changed-file audit still contains no print-agent, cloud-print, KDS, kitchen transport, migration, settlement-service, or inventory-write files.
- Frozen print/KDS paths remain untouched.

## Verification ledger

- Branch-safety review after the first final Green found one operational freshness risk: `roles` is not in the Supabase Realtime publication, so a permanently focused client could miss remote permission changes indefinitely.
- Restored a bounded 5-minute role refresh **only while the browser tab is visible**; hidden tabs do not poll. Focus/online/visibility recovery refresh remains throttled, and explicit role mutations still refresh immediately.
- This intentionally trades a tiny bounded read cost for branch permission freshness and safer live operation.
- Read-only Production branch check during this review confirmed both active branches had open shifts and live sales/kitchen activity; recent print jobs were reaching `submitted` with zero new failed jobs in the sampled two-hour window.


- Stage 4 Full Verify Green on `6d1d9e8dfdad4c65ae473a38eacee122e7e727be`.
- Workflow run `36328431098` / Verify main #3119: lint, typecheck, unit, build, fresh DB/schema, integration/security/RLS, and browser smoke all passed.
- Final read-only audit found no additional non-frozen database polling change with a comparable safety/benefit profile; further catalog caching was deliberately deferred because the current cache has no reliable freshness marker.
- Production remained unchanged throughout this workstream.


- Stage 3 exact-head Full Verify Green on `2bac970c0a87e39e051668c2a8f6190770bd8cae`.
- Workflow run `36327695426` / Verify main #3115:
  - mandatory active work log ✅
  - project identity ✅
  - API contract ✅
  - lint ✅
  - application + test typecheck ✅
  - unit tests ✅
  - build ✅
  - fresh DB/schema ✅
  - integration + security/RLS regression ✅
  - browser smoke ✅
- Read-only Production query audit identified the branch-scoped POS product catalog relation query (`products.*, category:categories(*)`) as a material historical cost source; POS code audit found no use of the nested `product.category` object, while `categories` is already loaded separately and product filtering uses `category_id`.


- Stage 2 corrected exact-head Full Verify Green on `5eec053a98498ba625f1c3b9f60bd7158efebbfb`.
- Workflow run `36326981479` / Verify main #3109:
  - mandatory active work log ✅
  - project identity ✅
  - API contract ✅
  - lint ✅
  - application + test typecheck ✅
  - unit tests ✅
  - build ✅
  - fresh DB/schema ✅
  - integration + security/RLS regression ✅
  - browser smoke ✅
- Production remained read-only; printing/KDS paths remained untouched.


- Stage 2 verification run `36326866171` / Verify main #3106: **FAILED at lint only**.
  - mandatory worklog ✅
  - project identity ✅
  - API contract ✅
  - lint ❌: `ProductBrowser.tsx` line 46 retained an unused `branchId` local after moving shift ownership to the parent.
  - typecheck/unit/build/DB/browser were skipped by workflow dependency after lint failure.
  - Existing 17 lint warnings are pre-existing/out of this scope; the one new error is isolated to the Stage 2 refactor.


- Repository identity confirmed: `Premieros/johna-s`.
- Production project confirmed: `azzdesuowpdcoflmyezn`.
- Current `main` confirmed at `ff796cac04a3c11416eaf8aa97d9cb71f536ffa6` before branch creation.
- Existing performance branches reconciled as stale/fully-behind current main.
- Production statistics/read-only SQL audit completed.
- Performance advisor audit completed read-only; no advisor-driven DDL is authorized in this stage.
- Stage 1 exact-head Full Verify Green on `7981d9f73696a051f806025d3b52fa8c1b7df232`.
- Workflow run `36326127272` / Verify main #3101:
  - mandatory active work log ✅
  - project identity ✅
  - API contract ✅
  - lint ✅
  - application + test typecheck ✅
  - unit tests ✅
  - build ✅
  - fresh DB/schema ✅
  - integration + security/RLS regression ✅
  - browser smoke ✅
- Production remained read-only; no schema/data/runtime deployment was performed.

## Production gate

State: **BLOCKED**

- No Production SQL write is authorized.
- No migration is planned for the first implementation stages.
- Merge is blocked until exact-head Full Verify Green and explicit user approval.
- Production application/runtime deployment remains blocked until merge approval.
- Printing/KDS changes are out of scope even after merge unless separately requested.

## Next action

1. Branch-safety correction implemented: visible-session role refresh restored at a bounded 5-minute cadence.
2. Run a new exact-head Full Verify on the corrected head.
3. Recheck current Production branch health read-only after CI.
4. Keep PR #391 Draft; no Merge, Production deployment, migration, printing/KDS change, or Production write without explicit approval.

## Mandatory update protocol

- Verify active branch HEAD against the expected prior commit before every repository write.
- Update Change ledger after each logical implementation group.
- Update Verification ledger after every test/CI run with the actual result and Run ID when available.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while this workstream is active.
- Do not merge or apply any Production migration until exact-head Full Verify Green and explicit approval.
- If any change unexpectedly reaches printing, Print Agent, print routing/queue/payload, KDS, kitchen transport, or send-to-kitchen paths: stop and revert that change before continuing.
