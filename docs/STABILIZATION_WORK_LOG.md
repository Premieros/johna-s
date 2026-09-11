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

| Area | Expected contract | Previous implementation | Current Stage 1 state |
| --- | --- | --- | --- |
| Purchase Request creation UI | `procurement.request.create` | `purchases.manage` | FIXED on branch; verification pending |
| `create_purchase_request` RPC | `procurement.request.create` | legacy `purchases.manage` gate | FIXED on branch; verification pending |
| Submit / Cancel transitions | Verify exact backend contract before changing UI | `purchases.manage` in UI | REVIEW ONLY in Stage 1 |
| Approve / Reject transitions | Verify exact backend/approval contract before changing UI | `purchases.manage` in UI | REVIEW ONLY in Stage 1 |
| RFQ creation | `purchases.rfq` | `purchases.rfq` | unchanged |

### Evidence reviewed

- `src/features/trade/pages/PurchaseRequestsPage.tsx`: creation had been grouped under `purchases.manage`; Stage 1 changes only the Create capability to `procurement.request.create`.
- `src/lib/permissionDefs.ts`: canonical model explicitly contains `procurement.request.create`, and the application preset for `branch_manager` includes it.
- `src/api/domains/procurement.ts`: frontend creation calls RPC `create_purchase_request`.
- `supabase/migrations/075_procurement_workflow.sql`: legacy RPC gate used `purchases.manage`.
- Later Permission-First migrations did not reconcile this RPC before Stage 1.
- `tests/integration/purchase_request_permission_first.test.ts`: permanent regression coverage proves the canonical permission, rejects legacy `purchases.manage`-only creation, and preserves branch isolation.
- `tests/integration/procurement_workflow.test.ts`: legacy fixture created `branch_manager` users but did not explicitly synchronize the newly canonical create capability in its transaction-local role fixture.

### What has been done

1. Stabilization branch was synced with the latest verified `main` before Stage 1 changes.
2. Added the Stage 1 work journal and one-stage execution gate.
3. Added a regression-safe migration aligning `create_purchase_request` to `procurement.request.create`; no Production migration was run.
4. Updated only the Purchase Request Create UI gate to `procurement.request.create`. Submit/Cancel/Approve/Reject were deliberately left unchanged pending their own backend-contract verification.
5. Added `tests/integration/purchase_request_permission_first.test.ts` covering:
   - same-branch user with `procurement.request.create` can create;
   - user with only legacy `purchases.manage` cannot create;
   - cross-branch creation remains rejected;
   - RPC definition contains the canonical permission and hardened search path.
6. Opened Draft PR #68 for Stage 1 only. It remains unmerged.
7. Verify #1073 passed identity lock, API contract, lint, typecheck, unit, build, Fresh DB migrations, schema, DB identity and Permission-First fixtures.
8. Verify #1073 then failed Integration/Security-RLS with 375 passed / 7 failed. All seven failures traced to the legacy `procurement_workflow.test.ts`; the new Stage 1 regression test itself passed 4/4.
9. Root cause: the legacy workflow fixture relied on the `branch_manager` preset while not synchronizing the newly canonical `procurement.request.create` permission. The first create failed, and six later failures were cascade failures because the request did not exist.
10. Fixed only the legacy test fixture in commit `9e31fec3435686683c7dfcb99031a7c58ffb4f95`: inside its BEGIN/ROLLBACK transaction it explicitly adds `procurement.request.create` to the test role's permission list. Runtime authorization, RLS and `can_permission` were not changed; no role-name bypass was introduced.
11. Renamed the legacy denial assertion to state the real contract: users without `procurement.request.create` are rejected.
12. Production Supabase `azzdesuowpdcoflmyezn` has not been modified.

### Verification/tests

- Static UI -> API -> RPC contract tracing: ✅
- New Permission-First regression test: ✅ 4/4 in Verify #1073
- Branch isolation regression: ✅ in the new test
- Verify #1073 pre-integration layers: ✅
- Verify #1073 Integration/Security-RLS: ❌ 375 passed / 7 failed, all attributable to the stale legacy fixture
- Legacy fixture correction: ✅ committed as `9e31fec3435686683c7dfcb99031a7c58ffb4f95`
- Re-run Full Verify after fixture correction: **PENDING**
- Browser Smoke after a green DB/integration job: **PENDING**

### Remaining in Stage 1

1. Re-run/review Full Verify on the latest Stage 1 head after `9e31fec3…` and this documentation update.
2. Require all layers green: lint/typecheck/unit/build, Fresh DB/schema/identity, Integration/Security-RLS, Browser Smoke.
3. If any failure appears, fix only the proven Stage 1 regression; do not broaden scope.
4. Once fully green, update this log to `VERIFIED` with final commit SHA and workflow evidence.
5. Keep PR #68 unmerged and stop after Stage 1 until the user writes `تم`.

## Deferred branch audit note

- `Premieros-patch-1`: **Superseded / Dangerous — DO NOT MERGE**. It contains changes that can weaken the Supabase identity lock / reintroduce environment ambiguity. No deletion is performed until the later branch-audit stage.
