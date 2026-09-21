# Cleopatra Main Area — 20 Tables — 2026-09-21

## Request
Reduce the default **Main Area** in the Cleopatra branch to **20 visible/active tables only**.

## Repository / branch
- Repository: `Premieros/johna-s`
- Base: `main@9e14cf5b2421809dfad3fd6b60a977b999fa2c47`
- Development branch: `development/cleopatra-main-area-20-20260921`

## Production inspection before implementation
- Supabase project: `azzdesuowpdcoflmyezn` (`john's`)
- Cleopatra branch id: `279e6662-e901-40b2-9170-7dda0b471ba7`
- Default area id: `27a61baa-3f48-4ae7-9dbf-e29822316332`
- Default area name: `Main Area`
- Active tables before change: **50**
- Target tables 21..50 were all `vacant` and had no non-final orders at inspection time.

## Important guard discovered
A direct attempt to deactivate Table 21..50 was rejected by the existing database contract:
- `DEFAULT_DINING_TABLE_FIXED`
- the existing migration `20260920170000_fixed_main_dining_area_and_english_tables.sql` intentionally fixes Main Area at 50 active canonical tables.

The guard was **not bypassed**.

## Safe design
Add a branch setting:
- `branch_settings.main_area_table_count`
- range: 1..50
- default: 50

Canonical rows `Table 01..Table 50` remain protected and undeletable.
Only their active state is synchronized from the branch setting.

### Safety rule
Reducing the count is blocked with `MAIN_AREA_TABLE_LIMIT_BUSY` if any table above the requested limit is occupied or has a non-final order.

## Implementation
Migration:
- `supabase/migrations/20260921090000_branch_main_area_table_limit.sql`

Changes:
- adds `main_area_table_count`
- adds branch-limit helper
- updates Main Area identity guard without weakening canonical identity/membership protection
- updates the canonical provisioner to keep 50 rows while activating only 1..limit
- adds an automatic branch-settings sync trigger
- keeps all private helpers revoked from public/authenticated callers

Types:
- `src/lib/domains/types/organization.ts`

Tests:
- `tests/unit/diningAreaWorkspaceContract.test.ts`
- `tests/integration/fixed_dining_table_contract.test.ts`

Integration coverage includes:
- new branch still starts with 50 active canonical tables by default
- branch setting 20 => exactly 20 active / 50 canonical rows
- manual reactivation above the limit remains rejected
- changing setting back to 25 => exactly 25 active

## Production application
**Status: COMPLETE — 2026-09-21**

### Merge
- PR #288 merged to `main`.
- Merge commit: `65bf325ec243d6dbe5d1a0721db5874a122f6111`.

### Verification before Production
- PR Verify run #2159: Full Green ✅
  - lint
  - TypeScript
  - app/test typecheck
  - unit
  - build
  - canonical migrations/schema
  - integration + security/RLS
  - Browser Smoke
- Post-merge `main` run #2164:
  - verify ✅
  - DB/schema/integration/security ✅
  - Browser Smoke running at the moment the Production operation was completed.
- The merge tree is identical to the Full-Green PR tree.

### Production migration
- Project: `azzdesuowpdcoflmyezn`
- Applied migration: `branch_main_area_table_limit`
- Supabase migration history recorded version: `20260921092200`
- Result: success.

### Cleopatra setting applied
- Branch: `279e6662-e901-40b2-9170-7dda0b471ba7`
- `main_area_table_count`: **20**

### Production verification after apply
Cleopatra Main Area:
- canonical rows retained: **50**
- active: **20**
- inactive: **30**
- active range: **Table 01..Table 20**
- inactive range: **Table 21..Table 50**
- inactive non-vacant tables: **0**
- inactive tables with non-final orders: **0**

Other branches:
- Smouha remains configured at **50**
- Smouha Main Area remains **50 active / 0 inactive**

Other Cleopatra areas were not changed by the Main Area setting:
- Floor 2: 27 active
- out door: 10 active
- In Door: 0
- p-2: 0
- Another: 5 active

### Safety conclusion
- No canonical table row was deleted.
- Existing table identities remain protected.
- No RLS/permission weakening.
- No printing, KDS, payment, inventory, accounting, shift or day-close logic changed.
- The change is branch-scoped and reversible by changing `main_area_table_count` to a safe value between 1 and 50.
