# Main Area Count UI / Active Tables Fix — 2026-09-21

## Trigger
Production data was correctly configured for Cleopatra Main Area:
- 20 active canonical tables
- Table 21..50 inactive

But the live POS still showed 50 and there was no edit-count action in the POS tables landing.

## Root Cause
1. `fetchActiveOrders()` loaded every `dining_tables` row for the branch and did **not** filter `is_active = true`.
2. The floor-plan badge still contained hard-coded text: `Fixed · 50 tables`.
3. The new branch setting `main_area_table_count` had no permission-first UI/RPC action exposed to users.
4. The user screenshot confirmed the required edit action must be available from the **POS tables workspace**, not only a back-office floor-plan page.

## Repository state at start
- Repository: `Premieros/johna-s`
- Base: `main@0d5ea68eeb62f31d03844cd6769753ae34de4d31`
- Development branch: `development/main-area-count-ui-20260921`

## Fix
### POS visibility
`src/features/pos/services/posOrders.ts`
- Main POS realtime snapshot now loads only `dining_tables.is_active = true`.
- This automatically affects the POS tables landing, table chooser, transfer targets and other consumers of the shared active-table snapshot.

### POS tables landing
`src/features/pos/components/tables/PosTablesSidebar.tsx`
- Added `branchId` as explicit branch scope.
- Added `تعديل العدد / Edit count` beside Main Area when:
  - the default area is selected;
  - user owns `floor_plan.manage`.
- Modal accepts 1..50.
- Clear error when reduction is blocked because a higher-number table is occupied/open.
- No role-name authorization.

### Active Orders / Floor Plan
`src/features/pos/components/floor/TableFloorPlan.tsx`
- Removed hard-coded `50` label.
- Shows actual active count.
- Added edit button for Main Area when user has floor-plan management permission.

`src/features/pos/pages/ActiveOrdersPage.tsx`
- Added count-edit modal.
- Uses canonical API setter.
- Updated old guidance that incorrectly said Main Area is always fixed at 50 active tables.

### Permission-first API boundary
Migration:
`supabase/migrations/20260921103000_floor_plan_main_area_table_count_rpc.sql`

RPC:
`public.floor_plan_set_main_area_table_count(uuid, integer)`

Server checks:
- authenticated user required
- `floor_plan.manage`
- `user_may_access_branch(p_branch_id)`
- branch must exist and be active
- count must be 1..50
- existing `MAIN_AREA_TABLE_LIMIT_BUSY` safety remains authoritative

No direct client write to `branch_settings` is used.

### API wrapper
`src/api/domains/floorPlan.ts`
- Added `setMainAreaTableCount()`.

## Safety
- No printing / Print Agent / cloud print / KDS changes.
- No sales/payment/accounting/inventory logic changes.
- No weakening of RLS.
- Existing canonical Table 01..50 identities remain preserved.
- Inactive canonical rows remain stored for history/reversibility.
- Other branches retain their own configured counts.

## Tests
Updated `tests/unit/diningAreaWorkspaceContract.test.ts` to lock:
- active-only POS dining table query;
- permission-first setter RPC;
- branch access check;
- POS Main Area edit button/input/save;
- floor-plan Main Area edit button;
- removal of hard-coded 50 label.

## Production
**Status: APPLIED — 2026-09-21**

### Merge
- PR #290 merged to `main`.
- Merge commit: `320413ed08a037c25d57a05c26e777a9e97da018`.

### Verification before merge
- Exact PR head `b6f5c960e99076b00d6c2ed14f286212b6c53793` passed Full Verify:
  - frontend API contract ✅
  - lint ✅
  - TypeScript ✅
  - full app/test typecheck ✅
  - unit ✅
  - build ✅
  - canonical migrations/schema ✅
  - integration + security/RLS ✅
  - Browser Smoke ✅

### Production RPC application
- Supabase project: `azzdesuowpdcoflmyezn`
- Applied migration: `floor_plan_main_area_table_count_rpc`
- RPC verified present:
  `public.floor_plan_set_main_area_table_count(p_branch_id uuid, p_count integer)`
- RPC remains `SECURITY DEFINER` with explicit Permission-First and branch-access checks.

### Production data after apply
Cleopatra:
- configured Main Area count: **20**
- canonical rows: **50**
- active: **20**
- inactive: **30**
- active range: **Table 01..Table 20**

Smouha:
- configured Main Area count: **50**
- active: **50**
- inactive: **0**

No branch table-count setting was changed while applying the UI/RPC fix.

### Deployment
- First Production parity attempt ran before the new RPC migration was applied and failed for the expected missing-route reason.
- After applying the RPC migration, the failed deployment workflow was rerun.
- Production API parity then passed ✅.
- GitHub Pages deployment was triggered from the same `main` merge tree.

### User-visible behavior
- POS table workspace now loads active dining tables only.
- Cleopatra Main Area therefore shows **20**, not 50.
- Users with `floor_plan.manage` see **تعديل العدد / Edit count** beside Main Area.
- The same permission-gated count editor is available in the Active Orders / Floor Plan surface.
- Inactive canonical tables remain stored for history and reversibility but are not shown for selling.


## Verification log
### PR #290 — first Verify attempt
- Verify run #2174 stopped at **frontend API contract** before lint/typecheck.
- Cause: new frontend RPC reference `floor_plan_set_main_area_table_count(branch_id,count)` was not yet added to `supabase/api-contract.json`.
- This was a contract-generation maintenance issue, not a runtime/business failure.
- Updated `supabase/api-contract.json` with the new RPC signature.
- New verification will run from the updated exact head.
