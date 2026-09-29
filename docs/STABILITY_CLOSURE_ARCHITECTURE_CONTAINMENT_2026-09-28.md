# STABILITY CLOSURE / ARCHITECTURE CONTAINMENT — 2026-09-28

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/stability-closure-architecture-containment-20260928`
Current PR: `#402`
Last updated: 2026-09-29
State: **BLOCKED** — Production writes and merge remain blocked by verification gates. Development work on PR #402 is active only within the documented branch/verification protocol.

## Plan status
Legend: ✅ complete · 🟡 in progress/partial · ⏳ not started · ⛔ intentionally deferred/frozen

### Phase 0 — Source of truth / branch closure
- ✅ New active branch created from verified `main`.
- ✅ `CURRENT_WORK_PLAN.md` now points to this track as the active Source of Truth.
- ✅ Previous Stability Foundation track marked merged/closed.
- ✅ Mandatory execution log created and enforced by CI.
- ✅ Documentation bootstrap Fast/Full Verify restored to Green after worklog compatibility fixes.
- 🟡 Old merged Stability Foundation branch is logically closed but still physically present because the available GitHub connector does not expose branch deletion.

### Phase 1 — Performance budgets / measurement
- ✅ Critical-path performance budget registry created.
- ✅ Repeatable Production read-only `pg_stat_statements` baseline harness created.
- ✅ CI contract added so critical budgets cannot disappear silently.
- ✅ Dashboard snapshot measured directly and found healthy in current DB conditions (~14–98ms for 7-day branch windows; ~81ms all-branch YTD), so it was removed from first-fix priority.
- ✅ POS active-order snapshot fan-out identified as the first proven hotspot.
- ✅ POS active-order snapshot reduced from ~5 client DB round trips to 3 by embedding `order_items` and `order_kitchen_sends` in the orders read.
- ✅ Regression contract added and round-trip budget tightened from 5 to 3.
- ✅ Inventory Ledger page direct branch lookup removed from the page; ledger RPC behavior itself remains unchanged.
- 🟡 Costing summary / raw-material overview still have cumulative hotspot evidence, but current direct authenticated latency baselines are not yet complete.
- ⛔ Cart-availability optimization is deferred until the user's parallel product repair is merged because that RPC scans product/catalog data.
- ⛔ Dashboard raw inventory/product fallback restructuring is deferred for the same product-work conflict.

### Phase 2 — Heavy-page / direct-data containment
- ✅ Architecture guard prevents any new direct page-level Supabase access outside the legacy allowlist.
- ✅ Legacy allowlist reduced from about 43 pages to **35 pages**.
- ✅ `ExpensesPage` removed from direct Supabase and from the allowlist.
- ✅ `JournalPage` removed from direct Supabase and from the allowlist.
- ✅ `BranchesPage` removed from direct Supabase and from the allowlist.
- ✅ `ReconciliationPage` removed from direct Supabase and from the allowlist.
- ✅ `PaymentsPage` removed from direct Supabase and from the allowlist.
- ✅ `EmployeeReceivableDetailPage` removed from direct Supabase and from the allowlist.
- ✅ `InventoryLedgerPage` removed from direct Supabase and from the allowlist.
- 🟡 `SuperAdminConsolePage` heavy read orchestration moved behind a read-only service; direct Supabase calls reduced from 12 to 3, but the remaining calls include sensitive mutations/health checks so the page remains allowlisted.
- 🟡 POS active-order data access is contained and cheaper, but `PosWorkspacePage` still has legacy direct data orchestration and remains allowlisted.
- ⛔ Product/catalog pages are intentionally untouched while parallel product work is active.
- ⛔ `ShiftsPage`, Print/KDS/Print Agent paths remain frozen because they are operationally sensitive.
- ⏳ `ImportExportCenterPage`, `SalesPage`, and the remaining allowlisted pages still need risk-ranked containment after conflict-sensitive areas are cleared.

### Phase 3 — Unified runtime control / health semantics
- ✅ Existing canonical `OfflineContext` + `syncEngine` baseline verified.
- 🟡 Runtime connectivity boundary contract added to stop new direct `navigator.onLine` usage outside the known legacy list; Fast Verify for this exact head is currently running.
- ⏳ Existing direct connectivity checks in POS/payment/cloud-print/cart/topbar still need gradual migration to the canonical runtime state.
- 🟡 System Health already has practical warning/error semantics inline, but they still need extraction into a deterministic tested helper.
- ⏳ Canonical runtime states `online / degraded / offline / syncing / blocked` are not yet fully centralized for all consumers.
- ⏳ Device/workstation identity foundation has not started.

### Phase 4 — Recovery / release resilience
- ⏳ Restore rehearsal procedure.
- ⏳ Non-Production restore + migrations + schema verification.
- ⏳ Golden Path on restored environment.
- ⏳ Branch-isolation / financial-reconciliation checks after restore.
- ⏳ Application rollback procedure.
- ⏳ Forward-only migration recovery policy.
- ⏳ Print Agent independent recovery verification.

### Final merge gate
- 🟡 `main` has advanced because of parallel product work. Before merge, this branch **must be updated from the latest `main`**, conflicts reconciled, and all product-side changes absorbed safely.
- ⏳ Final exact-head Fast Verify Green after latest-main reconciliation.
- ⏳ Final exact-head Full Verify Green.
- ⏳ Production API parity Green.
- ⏳ Live Smouha/Cleopatra read-only safety check.
- ⏳ Explicit user approval before merge.

## Guardrails
- Single writer only.
- No direct writes to `main`.
- No force push.
- Unexpected HEAD => STOP_AND_RECONCILE.
- No weakening Permission-First, RLS, branch isolation, or tests.
- Printing / Print Agent / routing / KDS / `send_to_kitchen` behavior remain frozen unless a separately proven regression requires review.
- No Production migration before exact-head Full Verify Green + explicit user approval.

## Baseline
- `main@69ee1d0c80d43bcdecfdb2a104455eafe7a5349b`
- PR #401 merged and deployed successfully.
- Post-merge Verify main #3296 Green.
- Deploy #859 Green.
- Production API parity Green.
- Smouha and Cleopatra remained operational after deployment.

## Root-cause ledger
- Full Verify #3297 failed only at the mandatory active-worklog contract.
- Root cause: the new log omitted legacy structural headings/markers required by `activeWorklogGateContract.test.ts`; no runtime, DB, RLS, print, KDS, or application regression was involved.

## Change ledger
- 2026-09-28: Phase 1 baseline registry added at `scripts/performance/critical-path-budgets.json`.
- 2026-09-28: repeatable Production read-only baseline query added at `scripts/performance/production-readonly-baseline.sql`.
- 2026-09-28: budget contract added at `tests/unit/performanceBudgetsContract.test.ts`.
- 2026-09-28: direct DB checks showed Dashboard snapshot currently healthy (~14-98ms for 7-day branch windows; ~81ms all-branch year-to-date), so Dashboard was removed from first-fix priority.
- 2026-09-28: cumulative `pg_stat_statements` identified POS active-order snapshot fan-out as the dominant repeated POS read family: ~36k order-item reads, ~36k kitchen-send reads, ~36k order reads and ~36k operator-label calls.
- 2026-09-28: active-order snapshot now embeds `order_items` and `order_kitchen_sends` into the existing orders read through verified foreign-key relationships, reducing the client snapshot from ~5 DB round trips to 3 without DB migration or write-path changes.
- 2026-09-28: POS active-order snapshot round-trip budget tightened from 5 to 3 and regression contracts added.
- 2026-09-28: created this Stability Closure / Architecture Containment track.
- 2026-09-28: switched `CURRENT_WORK_PLAN.md` to this branch and marked Stability Foundation as merged/closed.
- 2026-09-28: opened Draft PR #402.
- 2026-09-28: added compatibility markers required by the mandatory worklog CI gate.

## Verification ledger
- Fast Verify #1286 on `26ccdad564092cb0f40953529ba9be0434d3c883`: Green.
- Full Verify #3303 on the same head: Green.
- The active-order snapshot optimization is currently unmerged and awaiting exact-head verification after its final documentation checkpoint.
- Fast Verify #1280 on `895831dc68952e2f2610e95f06bb517fa7269d46`: Green.
- Full Verify #3297 on the same head: failed only at `activeWorklogGateContract.test.ts` before app/DB/browser jobs ran.
- Next verification: exact-head Fast Verify + Full Verify after this worklog compatibility repair.

## Production gate
Production writes: **BLOCKED**.
No Production schema/data change is authorized by this track unless exact-head Full Verify is Green and the user gives explicit approval.

## Next action
Verify the active-order snapshot fan-out reduction on the exact current head. If Green, measure and contain the next POS hotspot (`cart availability`) while avoiding all product-area files until the user's parallel product repair is merged. Before this PR can merge, update/rebase from the latest `main` and rerun full verification.


## Scope
This track is stability/build/organization only. No product feature development.

Repository: `Premieros/johna-s`
Base: `main@69ee1d0c80d43bcdecfdb2a104455eafe7a5349b`
Branch: `development/stability-closure-architecture-containment-20260928`
Production Supabase: `azzdesuowpdcoflmyezn`

## Hard safety fences
- Single writer only.
- No direct writes to `main`.
- No force push.
- Before every write, verify the expected branch HEAD. Unexpected HEAD => STOP_AND_RECONCILE.
- No weakening Permission-First, RLS, branch isolation, or tests.
- Super Admin remains implicit bypass only.
- Printing / Print Agent / routing / KDS / `send_to_kitchen` behavior remain frozen unless a separately proven regression requires a reviewed fix.
- No Production migration before exact-head Full Verify Green + explicit user approval.
- No data rewrite/reset/reseed to make tests pass.
- Runtime changes must remain backward-compatible with live Smouha and Cleopatra operations.

## Why this track exists
The Stability Foundation is merged and deployed successfully. Core operation is now stable and tested. Remaining risk is primarily structural:
1. oversized pages that still combine UI, orchestration, and data access;
2. a wide legacy page direct-Supabase allowlist;
3. heavy RPC/page latency without formal budgets;
4. runtime state and device/workstation identity are not centrally modeled;
5. source-of-truth and merged-branch cleanup;
6. recovery/restore readiness is not yet an explicit operational gate.

## Current verified baseline
- PR #401 merged to `main`.
- Post-merge Verify main #3296 Green.
- Deploy #859 Green.
- Production API parity Green.
- Production branches Smouha and Cleopatra continued operating after deployment.
- No stale print jobs were observed in the final checks.
- Core Golden Path and kitchen idempotency/concurrency tests are present.
- ReportsPage and SystemHealth are already behind service/domain boundaries.
- A page architecture guard prevents new direct Supabase page access outside the legacy allowlist.

## Measured structural hotspots
Approximate current page sizes / direct data access:
- `ImportExportCenterPage.tsx`: ~1633 lines, 8 direct Supabase calls.
- `ReportsPage.tsx`: ~1360 lines, 0 direct Supabase calls.
- `PosWorkspacePage.tsx`: ~1210 lines, 5 direct Supabase calls.
- `SuperAdminConsolePage.tsx`: ~1180 lines, 12 direct Supabase calls.
- `FinancialReportsPage.tsx`: ~950 lines, 2 direct Supabase calls.
- `SalesPage.tsx`: ~870 lines, mixed direct `from/rpc`.
- `PurchasesPage.tsx`: ~809 lines, 7 direct Supabase calls.
- `ProductsPage.tsx`: ~429 lines, 13 direct Supabase calls.

The legacy page allowlist currently contains roughly forty pages. The goal is monotonic reduction, not a rewrite.

## Measured performance hotspots
Current `pg_stat_statements` indicates notable cost in:
- `get_costing_sales_summary`
- `get_raw_material_cost_overview`
- `get_dashboard_sales_snapshot`
- inventory-ledger related reads
- historically high-volume `send_to_kitchen`

These statistics are cumulative and include diagnostic/admin traffic, so they are hotspot signals, not final SLAs.

## Operating principles for this track
1. Measure first.
2. Contain before refactor.
3. Prefer call-shape/query-shape fixes before indexes or schema changes.
4. Move orchestration behind feature services/domain APIs without changing UI behavior.
5. Reduce the direct-Supabase allowlist monotonically.
6. Do not split a page merely because it is large; split only where responsibilities or load behavior justify it.
7. Every performance change must have a contract/test that prevents regression.
8. Every operational change must preserve printing, KDS, live shifts, and branch isolation.

# Phase 0 — Source of truth and branch closure
- [ ] Replace stale Stability Foundation active references.
- [ ] Mark `development/stability-foundation-20260928` as merged/closed in the active plan.
- [ ] Preserve only `main`, latest Cleopatra Print Agent branch, latest Smouha Print Agent branch, and this active development branch.
- [ ] Create one mandatory execution log for this track.
- [ ] Run Fast Verify after documentation bootstrap.

Exit gate:
- active plan points only to this branch;
- no stale branch is treated as an execution baseline.

# Phase 1 — Performance budgets and repeatable measurement
## 1A. Critical-path budgets
Define and enforce initial budgets for:
- POS active orders / resume;
- POS availability/cart availability;
- `send_to_kitchen`;
- payment settlement path;
- active shift read;
- dashboard snapshot;
- inventory ledger page;
- costing summary;
- raw-material cost overview;
- day/shift close reads.

Initial targets should be conservative and based on Production measurements, not arbitrary aspirational values.

## 1B. Measurement harness
- [ ] Add a repeatable read-only benchmark harness for critical RPC/query paths.
- [ ] Record branch/date/payload shape with each benchmark.
- [ ] Separate user/runtime traffic from diagnostic/admin SQL where possible.
- [ ] Add regression thresholds where CI can reasonably enforce them.
- [ ] For Production-only measurements, record them in this log without making CI depend on Production.

## 1C. Immediate hotspots
Prioritize:
1. dashboard snapshot execution plan;
2. costing summary;
3. raw-material cost overview;
4. inventory ledger;
5. POS resume/availability read amplification.

Exit gate:
- documented budgets exist;
- each critical hotspot has a measured baseline;
- no optimization is accepted without before/after evidence.

# Phase 2 — Heavy-page containment
Goal: reduce page responsibility and direct database coupling without redesigning the UI.

Priority order:
1. `PosWorkspacePage.tsx`
2. `SuperAdminConsolePage.tsx`
3. `ImportExportCenterPage.tsx`
4. `ProductsPage.tsx`
5. `PurchasesPage.tsx`
6. `SalesPage.tsx`
7. remaining legacy allowlist pages only when measured or touched.

For each page:
- [ ] identify data-load orchestration;
- [ ] extract to feature service or `src/api/domains`;
- [ ] keep mutation authorization semantics unchanged;
- [ ] keep UI behavior unchanged;
- [ ] keep branch scoping unchanged;
- [ ] remove page from legacy allowlist once direct Supabase access is zero;
- [ ] add a focused architecture contract.

Rules:
- No full rewrite.
- No framework/state-management migration.
- No broad visual redesign.
- No unrelated cleanup bundled with containment.

Exit gate:
- legacy allowlist count decreases monotonically;
- no new direct page-level Supabase access;
- priority pages no longer mix heavy data orchestration with rendering where practical.

# Phase 3 — Unified runtime control
This is an operational foundation, not a user-facing feature initiative.

## 3A. Runtime state model
Unify the currently scattered runtime signals into a small canonical state model:
- `online`
- `degraded`
- `offline`
- `syncing`
- `blocked`

Inputs may include:
- network reachability;
- Supabase reachability;
- Realtime health;
- offline queue state;
- blocked/dead-letter state;
- Print Agent/KDS health observations only, without taking control of them.

Requirements:
- no polling storm;
- no duplicate sources of truth;
- state transitions must be testable;
- UI consumes the state instead of reinventing it per page.

## 3B. Operational thresholds
Promote System Health observations into explicit severity rules:
- duplicate open shift => critical;
- accounting imbalance => critical;
- kitchen/inventory mismatch => critical;
- stale print queue => warning/critical by age;
- stale empty order/table mismatch => warning;
- branch connectivity degradation => warning.

No auto-repair in this phase unless separately reviewed.

## 3C. Device/workstation identity foundation
Establish a minimal internal identity model for operational observability:
- branch;
- logical device/workstation identity;
- role/type such as POS/KDS/Print Agent where applicable;
- app/agent version;
- last-seen/heartbeat metadata where already available or safely addable.

This is not a feature expansion. It is intended to make operational state attributable and debuggable.

Exit gate:
- runtime state is centralized;
- System Health has deterministic severity semantics;
- operational events can be attributed to branch/device where appropriate.

# Phase 4 — Recovery and release resilience
## 4A. Restore rehearsal
- [ ] document a restore rehearsal procedure;
- [ ] restore a representative backup/snapshot into a non-Production environment;
- [ ] apply current migrations;
- [ ] run schema verification;
- [ ] run Golden Path;
- [ ] verify branch isolation and core financial reconciliation.

## 4B. Release rollback readiness
- [ ] document application rollback procedure;
- [ ] document forward-only migration recovery policy;
- [ ] verify that deployment rollback does not silently require schema downgrade;
- [ ] verify Print Agent branches remain independently recoverable.

## 4C. Final hygiene
- [ ] no stale active work references;
- [ ] merged temporary branches removed where tooling permits;
- [ ] final exact-head Fast Verify Green;
- [ ] final exact-head Full Verify Green;
- [ ] Production API parity Green;
- [ ] live branch read-only safety check;
- [ ] stop before merge and require explicit user approval.

# Definition of done
This track is complete only when:
- critical operational paths have documented latency/call budgets;
- the heavy-page direct-Supabase allowlist is materially reduced;
- no new direct page-level Supabase access exists;
- priority heavy pages are behind stable service/domain boundaries;
- runtime state is centralized and testable;
- System Health has severity thresholds;
- device/workstation operational identity is defined at least minimally;
- restore/recovery has been rehearsed on a non-Production environment;
- exact-head Full Verify and Production parity are Green;
- Smouha and Cleopatra remain operational;
- printing/KDS/Print Agent behavior remains unchanged unless an explicitly approved regression fix was required.

## Mandatory update protocol
- Read this file before every write.
- Verify active branch HEAD before every write.
- Record every coherent change set and verification result.
- Unexpected HEAD => STOP_AND_RECONCILE.
- No Production write without an explicit documented gate and user approval.
