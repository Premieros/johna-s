# DECIMAL COSTING COMPOSITE — 2026-09-28

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/decimal-costing-composite-20260928`
Current PR: `#403`
Last updated: 2026-09-28
State: **BLOCKED**

Scope is intentionally narrow: decimal numeric entry and Costing Center visibility/costing for linked manufactured component groups. Production migration and merge remain blocked until exact-head verification is Green and explicit approval is received.

## Guardrails
- No direct writes to `main`.
- No force push.
- Unexpected branch HEAD => STOP_AND_RECONCILE.
- No weakening RLS, Permission-First, branch isolation, or test coverage.
- No changes to POS stock deduction, send-to-kitchen, printing, Print Agent, routing, KDS, shifts, or day-close behavior.
- No Production migration before Full Verify Green and explicit approval.
- Source database/production data must not be rewritten to make tests pass.

## Baseline
- Production/main baseline at start: `69ee1d0c80d43bcdecfdb2a104455eafe7a5349b`.
- Initial defect-fix head before work-log repair: `3ced129d04056269f5ce75f4786e55a1d5db32cb`.
- PR #403 is Draft and targets `main`.
- Initial compare: ahead by 4, behind by 0.

## Root-cause ledger
1. Controlled `type="number"` fields parsed every keystroke to a number. Intermediate drafts such as `0.` collapsed back to `0`, preventing entry of values such as `0.050`.
2. Costing RPCs read direct `recipe_items` only. They omitted linked manufactured component groups in `product_unit_links -> inventory_units -> inventory_unit_recipes`, so their raw materials did not appear in product costing detail and were not included in actual recipe cost.
3. First PR workflow run failed before lint/typecheck/tests because the mandatory active work log still pointed to the completed Stability Foundation branch.

## Change ledger
- `src/components/Input.tsx`: preserve controlled numeric draft text while focused, while keeping the existing parent `onChange` contract.
- `supabase/migrations/20260928231500_costing_linked_component_groups.sql`: include linked manufactured component-group raw lines in product recipe cost, detail, overview, and recipe item count.
- `src/lib/domains/types/costing.ts`: add optional component-group metadata to costing recipe lines.
- `src/features/costing/pages/CostingCenterPage.tsx`: show whether a raw material is direct or comes from a linked component group.
- `docs/CURRENT_WORK_PLAN.md`: activate this bounded defect-fix track.
- This log records verification and production-gate state.

## Verification ledger
- Branch/PR head checked before continuation: no unexpected movement.
- `main` checked at `69ee1d0c80d43bcdecfdb2a104455eafe7a5349b`.
- PR #403 currently reports mergeable.
- First workflow run `36477015327` failed only at the mandatory active work-log gate; all later verification steps were skipped.
- Focused decimal input test: pending.
- Linked component-group costing DB/integration test: pending.
- Full Verify on exact final head: pending.
- Production API parity: pending.
- Printing/KDS/agent regression confirmation: pending.

## Production gate
State: **BLOCKED**

Do not merge PR #403 and do not apply `20260928231500_costing_linked_component_groups.sql` to Production until:
1. focused tests are added and Green;
2. exact-head Full Verify is Green;
3. Production API parity is Green;
4. no operational printing/KDS/POS deduction path changed;
5. explicit approval is received.

## Next action
Add focused regression coverage for decimal numeric drafting and linked component-group costing, then inspect the next PR workflow run. Fix only failures causally related to this branch.

## Mandatory update protocol
- Update this log whenever root cause, code scope, HEAD, verification, or production-gate state changes.
- Keep `State: **BLOCKED**` until all merge and Production gates are satisfied.
- Before every write, verify branch continuity when another writer may have changed the head.
- Record exact final head before requesting merge approval.
