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

Status: **VERIFIED**
Route reference: `#/purchases/requests`
Verified code/documentation head before this closure-only log commit: `fe81c38ac7508e5993541a61e87824dd036378f8`
Verification workflow: **Verify main #1076 — Full Green**
Draft PR: **#68 — remains unmerged**

### Goal
Align Purchase Request creation with the canonical Permission-First contract without changing unrelated procurement behavior.

### Confirmed deviation and closure

| Area | Expected contract | Previous implementation | Stage 1 result |
| --- | --- | --- | --- |
| Purchase Request creation UI | `procurement.request.create` | `purchases.manage` | VERIFIED FIXED |
| `create_purchase_request` RPC | `procurement.request.create` | legacy `purchases.manage` gate | VERIFIED FIXED |
| Submit / Cancel transitions | Verify exact backend contract before changing UI | `purchases.manage` in UI | intentionally deferred; not modified |
| Approve / Reject transitions | Verify exact backend/approval contract before changing UI | `purchases.manage` in UI | intentionally deferred; not modified |
| RFQ creation | `purchases.rfq` | `purchases.rfq` | unchanged |

### Evidence reviewed

- `src/features/trade/pages/PurchaseRequestsPage.tsx`: Stage 1 changes only the Create capability to `procurement.request.create`.
- `src/lib/permissionDefs.ts`: canonical model explicitly contains `procurement.request.create`, and the application preset for `branch_manager` includes it.
- `src/api/domains/procurement.ts`: frontend creation calls RPC `create_purchase_request`.
- `supabase/migrations/075_procurement_workflow.sql`: legacy RPC gate used `purchases.manage`.
- Later Permission-First migrations did not reconcile this RPC before Stage 1.
- `tests/integration/purchase_request_permission_first.test.ts`: permanent regression coverage proves the canonical permission, rejects legacy `purchases.manage`-only creation, and preserves branch isolation.
- `tests/integration/procurement_workflow.test.ts`: legacy fixture was corrected to synchronize the canonical create permission inside its transaction only; Runtime Authorization/RLS were not weakened.

### What was done

1. Stabilization branch was synced with verified `main` before Stage 1 changes.
2. Added the Stage 1 work journal and one-stage execution gate.
3. Added a regression-safe migration aligning `create_purchase_request` to `procurement.request.create`; no Production migration was run.
4. Updated only the Purchase Request Create UI gate to `procurement.request.create`. Submit/Cancel/Approve/Reject were deliberately left unchanged pending their own backend-contract verification.
5. Added permanent regression coverage proving:
   - same-branch user with `procurement.request.create` can create;
   - user with only legacy `purchases.manage` cannot create;
   - cross-branch creation remains rejected;
   - RPC definition contains the canonical permission and hardened search path.
6. Opened Draft PR #68 for Stage 1 only; it remains unmerged.
7. Verify #1073 exposed a stale legacy integration fixture: 375 tests passed / 7 failed, all seven cascading from the first Purchase Request creation failure. The new Stage 1 test itself passed 4/4.
8. Root cause was documented: the old procurement workflow fixture created `branch_manager` users but did not synchronize the newly canonical create capability used by the app preset.
9. Fixed only that fixture in commit `9e31fec3435686683c7dfcb99031a7c58ffb4f95`, inside BEGIN/ROLLBACK. No role-name authorization, no RLS weakening and no Production change were introduced.
10. Verify #1076 on head `fe81c38ac7508e5993541a61e87824dd036378f8` completed Full Green.
11. Production Supabase `azzdesuowpdcoflmyezn` has not been modified.

### Verification/tests — final Stage 1 evidence

- Locked Supabase project identity: ✅
- Frontend API contract: ✅
- Lint: ✅
- Application typecheck: ✅
- Application/test-suite typecheck: ✅
- Unit tests: ✅
- Build: ✅
- Fresh DB / canonical migrations: ✅
- Schema verification: ✅
- DB identity: ✅
- Explicit Permission-First CI role capabilities: ✅
- Integration + Security/RLS regression suite: ✅
- Purchase Request Permission-First regression test: ✅ 4/4
- Browser Smoke / Playwright: ✅
- Verify main #1076: **FULL GREEN**

### Remaining after Stage 1

- **No Stage 1 code/test work remains.**
- PR #68 stays Draft/unmerged.
- No migration has been applied to Production.
- Do not start Stage 2 until the user writes `تم`.

## Deferred branch audit note

- `Premieros-patch-1`: **Superseded / Dangerous — DO NOT MERGE**. It contains changes that can weaken the Supabase identity lock / reintroduce environment ambiguity. No deletion is performed until the later branch-audit stage.
