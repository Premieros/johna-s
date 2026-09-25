# SYSTEM CLEANUP ROOT FIXES — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/system-cleanup-root-fixes-20260925`
Current PR: `#372`
Last updated: 2026-09-25 23:05 Africa/Cairo

## Work status

State: **BLOCKED**

Cleanup implementation is isolated on PR #372. Merge remains blocked until exact-head Full Verify is Green and explicit approval is given.

## Guardrails

- Parallel report-rebuild work is active elsewhere: this branch must not modify reporting pages, financial report pages, report metric sources, report export code, or report-specific tests unless separately reconciled first.

- Single Writer only.
- No direct write to `main`.
- Before every write, verify the expected branch HEAD and current `main`; unexpected movement = STOP_AND_RECONCILE.
- No force push.
- No Production migration in this phase.
- No RLS or test weakening.
- Printing / Print Agent / printer routing / KDS / send-to-kitchen / shifts are frozen and out of scope.
- Historical applied migrations are append-only and are not deleted or rewritten.
- Production is not a test environment.

## Baseline

- Base: `main@29f99187574fd700cee5da6b71d9b4b13339022c`.
- That main head is the merge result of PR #371 (session-memory SWR/full-server export work).
- PR #371 exact-head Verify was Green before this cleanup branch was created.
- This cleanup branch was created directly from that exact main head.
- No Production database write or migration has been performed by this cleanup.

## Root-cause ledger

1. The retired manufacturing application surface still existed even though production routes were already redirected away from the old workflow.
2. Legacy manufacturing API methods still contained client-side fallback writes to `production_orders`, creating a second mutation path outside the authoritative RPC transactions.
3. Production-only UI permissions and `guardProduction` kept obsolete application concepts alive after the business model moved to direct component/raw-material consumption.
4. `InventoryUnitsPage` still depended on `production.manage` to edit unit component definitions, coupling reusable component configuration to the retired production workflow.
5. Historical database functions/migrations still exist for compatibility and audit history; deleting or rewriting applied migrations is not a safe application cleanup strategy.

## Change ledger

### P0 — Fail closed
- Removed all client-side fallback writes from legacy manufacturing create/start/cancel actions.
- During the transition, create/start/complete/cancel delegated only to authoritative RPCs and failed closed.

### P1 — Retire production application surface
- Removed `src/api/domains/manufacturing.ts`.
- Removed `ProductionOrdersPage.tsx`.
- Removed `UnitProductionPage.tsx`.
- Removed unused `ManufacturingCenterPage.tsx`.
- Removed manufacturing API export from `src/api/modules.ts`.
- Removed `catalog.produceInventoryUnit`.
- Removed production-only application permissions and permission dependencies.
- Removed `guardProduction`.
- Rebound inventory-unit component editing from `production.manage` to `recipes.manage`.
- Preserved old `/production`, `/production/units`, and manufacturing-center URLs as safe redirects to Recipes instead of breaking bookmarks.
- Removed tests that artificially preserved the retired UI.
- Added `tests/unit/manufacturingRetirementContract.test.ts` to prevent the retired application surface/API/permissions from silently returning.

### P2 — Dead/dormant code cleanup
- Read-only re-proof started while verification runs.
- Legacy subscription runtime/UI cleanup is already present on current main and protected by `legacySubscriptionCleanupContract.test.ts`; it will not be duplicated.
- `ReportDeepLinkPage` and remaining V2 wrappers require current caller/contract proof before any write.

### P3 — Data-source unification
- Pending until P1 is exact-head Green.

### P4 — Database retirement
- Separate future phase only; no action in PR #372.

## Verification ledger

- Initial PR #372 Verify run `36180155015`: failed only at mandatory active-worklog structure before lint/type/unit/build executed.
- Follow-up Verify run `36183410233`: failed only because this log still lacked the required `## Baseline` heading.
- No application-code failure has been observed yet because both runs stopped at the worklog gate.
- Exact-head verification rerun `36183550578`: worklog gate and Supabase identity passed; frontend API contract failed because the retired production RPCs and `inventory_unit_productions` table were still present in the generated contract.
- Regenerated `supabase/api-contract.json` to remove only those no-longer-referenced frontend contract entries. Historical DB objects/migrations remain untouched.
- Exact-head verification run `36187315353`: worklog, Supabase identity, frontend API contract and lint passed; typecheck failed only on three stale production permissions still present in the `production_manager` default-role array.
- Removed only those three retired permission strings; no report files or report data sources touched.
- Exact-head verification must rerun on the new head.

## Production gate

State: **BLOCKED**

- No Production migration is included in PR #372.
- No Production SQL write is authorized by this phase.
- Historical production tables/functions remain untouched for compatibility.
- Any future DB retirement must be additive/forward-only, pass Full Verify, and receive explicit approval before Production application.

## Next action

Run exact-head Full Verify on the current PR #372 head after the API-contract regeneration. Fix only regressions caused by this cleanup. Do not begin P2 writes and do not merge until the branch is Green.

## Mandatory update protocol

- Check branch HEAD and current `main` before every write.
- Unexpected HEAD = STOP_AND_RECONCILE.
- Update this log after each logical change group and after every verification result.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while PR #372 is the active work scope.
- No parallel writer on this branch.
- No Merge and no Production migration before exact-head Full Verify Green plus explicit approval.
