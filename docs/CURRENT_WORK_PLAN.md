# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **ERP-05 Waste Center Completion**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `9f542a52fd853e34ad429195903f25c8c9d6da43`
- Active development branch: `development/erp05-waste-center-20261003`
- Mandatory active work log: `docs/ERP05_WASTE_CENTER_2026-10-03.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- No Production schema/data/history mutation during the audit/implementation branch.
- Preserve Permission-First, RLS, branch isolation, warehouse isolation, audit history and FIFO accounting truth.
- Existing cancelled-scope tombstones remain in force; ERP-05 does not reactivate any cancelled dashboard/treasury/report restructuring.
- Printing, Print Agent, KDS routing, POS sale deduction and `send_to_kitchen` remain frozen unless a separately proven ERP-05 dependency requires a bounded change.

## Current objective
Complete ERP-05 Waste Center against the existing implementation without rebuilding it from scratch. Close only proven gaps in waste classification, approval-time inventory costing, employee attribution, reporting, and Food Cost impact.

## Verified baseline
- Existing Waste Center page, service boundary, permissions and approval flow are already present.
- Canonical write path is `create_waste_entry` -> pending -> `approve_waste`; stock is deducted only on approval.
- Existing target model is product or inventory unit; direct raw-material target is deprecated.
- Legacy `production` waste remains historical compatibility and must not be reintroduced as a new manufacturing workflow.
- Production read-only audit on 2026-10-03 found:
  - product inventory/batch quantity mismatches: 0;
  - positive product inventory rows without FIFO batches: 0;
  - current `waste_entries`: 0 rows;
  - current `waste_categories`: 0 rows.
- Forward-only migration now exists on the development branch: `supabase/migrations/20261003123000_erp05_waste_fifo_approval.sql`.
- The migration has been validated on Fresh DB CI but has **not** been applied to Production.
- PR #437 exact-head run #3665 was fully Green: verify / db / browser-smoke.

## Definition of done
- Legacy production-waste rows remain visible but cannot be newly created from the operational Waste Center.
- Approved waste cost is derived from the authoritative FIFO batches actually consumed, not trusted from a user-entered estimate.
- Batch/inventory inconsistencies fail closed and roll back atomically.
- Waste records retain deterministic employee/actor attribution.
- Kitchen waste is representable without reviving retired manufacturing flows.
- Waste reporting preserves branch scope, approval scope and historical visibility and uses authoritative approved cost.
- Regression tests cover FIFO valuation, rollback, branch/permission isolation and legacy-production creation guard.
- Exact-head Verify + DB/Security/RLS + Browser Smoke are Green before merge.
- Production migration remains blocked until a separate explicit approval after Green CI.


## Current implementation status
- PR: `#437` (Draft until final exact-head documentation sync is Green).
- UI/service legacy-production guard: implemented.
- Entry-time waste cost: display-only estimate.
- FIFO-authoritative approval costing: implemented in forward-only migration.
- FIFO coverage mismatch: fail-closed with atomic rollback.
- Employee attribution default: authenticated actor.
- Waste category repair/seed: implemented idempotently, including Kitchen Waste.
- Exact approved FIFO total: persisted separately as `approved_total_cost`.
- Waste report cost: authoritative movement cost with historical fallback.
- Production write/apply: **none**.

## Queued next work — after ERP-05 is closed
Open a separate System Health track/PR for **Branch Pulse / نبضة الفروع**. Do not implement it inside ERP-05.

Requested scope:
- selectable time window: 30m / 1h / 3h / 6h / 12h / Today / 24h / Custom;
- per-branch quick snapshot of orders, sales, prints, purchases, expenses, shifts and operational warnings;
- user-facing error telemetry: branch, user, screen/action, safe error code/message, time, recurrence and affected-user count;
- separate expected business errors from unexpected system failures;
- quick “show problems only” view;
- read-only System Health presentation; no dashboard changes.
