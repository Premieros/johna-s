# Stabilization Work Log

Date: 2026-09-11
Repository: `Premieros/johna-s`
Working branch: `development/stabilization-phase-2`
Production branch: `main` (read-only during stabilization)
Production Supabase: `azzdesuowpdcoflmyezn` (no migration is applied during a stage before Full Verify is green)

## Execution protocol

- `docs/CURRENT_WORK_PLAN.md` remains the Source of Truth.
- Work proceeds one stage at a time.
- Each stage is tracked as `IN PROGRESS`, `VERIFIED`, or `BLOCKED`.
- Every stage records: what was done, verification/tests, remaining work, and evidence.
- The next stage MUST NOT start until the user writes `تم` after the current stage report.
- No direct writes to `main`, no force push, no weakening RLS/tests, no role-name authorization. Super Admin is the only implicit bypass.
- Do not touch other repositories or databases.

## Stage 1 — Purchase Requests Permission Stabilization

Status: **IN PROGRESS**
Route reference: `#/purchases/requests`

### Goal
Align Purchase Request creation with the canonical Permission-First contract without changing unrelated procurement behavior.

### Confirmed deviation

| Area | Expected contract | Current implementation | Status |
| --- | --- | --- | --- |
| Purchase Request creation UI | `procurement.request.create` | `purchases.manage` | IN PROGRESS |
| `create_purchase_request` RPC | `procurement.request.create` | legacy `purchases.manage` gate from procurement workflow | IN PROGRESS |
| Submit / Cancel transitions | Verify exact backend contract before changing UI | `purchases.manage` in UI | REVIEW ONLY in Stage 1 |
| Approve / Reject transitions | Verify exact backend/approval contract before changing UI | `purchases.manage` in UI | REVIEW ONLY in Stage 1 |
| RFQ creation | `purchases.rfq` | `purchases.rfq` | no change planned |

### Evidence reviewed

- `src/features/trade/pages/PurchaseRequestsPage.tsx`: Create, Submit, Approve/Reject and Cancel are currently grouped under `purchases.manage`; RFQ is separately gated by `purchases.rfq`.
- `src/lib/permissionDefs.ts`: canonical permission model explicitly contains `procurement.request.create` / "Create Purchase Requests".
- `src/api/domains/procurement.ts`: frontend creation calls RPC `create_purchase_request`.
- `supabase/migrations/075_procurement_workflow.sql`: legacy RPC gate uses `purchases.manage`.
- Later Permission-First migrations reviewed so far do not explicitly reconcile `create_purchase_request` to `procurement.request.create`.

### What has been done

1. Stabilization branch synced with the latest verified `main` before Stage 1 changes.
2. Located the exact UI permission drift.
3. Confirmed canonical frontend permission definition.
4. Confirmed API-to-RPC mapping.
5. Traced the legacy backend permission gate and checked later Permission-First normalization layers.
6. No Production database change has been made.

### Verification/tests

- Static contract tracing: completed for UI -> API -> base RPC.
- Final SQL/RLS contract verification: in progress.
- Regression test: pending.
- Full Verify: pending.

### Remaining in Stage 1

1. Add a regression-safe migration to align `create_purchase_request` with `procurement.request.create` while preserving branch isolation and Super Admin behavior.
2. Update the Purchase Requests UI Create action to `procurement.request.create`.
3. Add regression coverage for permission allow/deny behavior and legacy gate absence.
4. Run branch verification / CI.
5. Update this log with commit SHA, workflow evidence and final status.
6. Stop after Stage 1 and wait for the user to write `تم` before any next stage.

## Deferred branch audit note

- `Premieros-patch-1`: **Superseded / Dangerous — DO NOT MERGE**. It contains changes that can weaken the Supabase identity lock / reintroduce environment ambiguity. No deletion is performed until the later branch-audit stage.
