# Sales composition reporting
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/sales-composition-reports-20261026`
Current PR: #542
Last updated: 2026-10-26

## Work status
State: **BLOCKED**
Preparation authorized; production rollout is not authorized.

## Guardrails
Read-only reporting. No new source tables, privileged functions, RLS or grants. Preserve kitchen/printing, POS operations, inventory and accounting writers. No production tests or log scans.

## Baseline
Main d3649e42320902c9a6bb1aaaecaac80fb2cd7180. Existing canonical invoice source and sold-recipe consumption RPC.

## Root-cause ledger
Product summary omits saved options; source projection omits saved modifier snapshots and bonus quantities. Manufactured composition exists in the canonical consumption recursive walk but has no report projection. Material consumption exists separately and must be reused, not recomputed or counted as sales revenue.

## Change ledger
Expose immutable saved modifier snapshot and bonus quantity through the same invoice source. Group products by recorded option combination without reallocation; standalone option selection counts carry no duplicated invoice revenue. Add a manufactured-unit projection of the existing normalized sold quantities and recursive recipe walk. Expose the same consumption component through sales workspace shortcuts. Keep incompatible quantity totals blank. Add station/category labels and station filter, per-product distinct containing-invoice counts and separate bonus quantities. These quantities/counts are non-additive. Manufactured quantities project current base composition; they are not actual production or independently attributable sales revenue. No alternate ingredient pricing engine.

## Verification ledger
47 focused unit/component tests passed; application and test TypeScript checks passed. Source API contract check passed (171 RPCs / 56 tables). Isolated CI must verify canonical migration guards, manufactured-unit projection, unchanged raw consumption, saved sale metadata, permissions and rollback. No production operational tests.

## Production gate
No Merge ولا Production migration before separate release approval. Read function migration and guarded rollback must pass isolated integration tests, and live definitions must match preflight before eventual approval.

## Next action
Implement and verify candidate; open one review PR.

## Mandatory update protocol
Single writer. Update final exact-head results in PR ledger; avoid documentation-only broad reruns.
