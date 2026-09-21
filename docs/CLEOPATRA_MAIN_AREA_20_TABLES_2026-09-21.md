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
Not applied yet.
Required sequence:
1. Full Verify green on exact development head.
2. Merge migration to `main`.
3. Apply the migration to production.
4. Set Cleopatra `main_area_table_count = 20`.
5. Verify Main Area has 20 active tables, Table 01..20 active and Table 21..50 inactive.
6. Confirm other Cleopatra areas and all other branches are unchanged.
