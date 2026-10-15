# Sage → Open Mercato identity export — owner-approved single writer
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/sage-openmercato-identity-export-20261015`
Current PR: #509
Last updated: 2026-10-15 Cairo

## Work status
State: **BLOCKED** for any production merge/deployment until the exact-head Full Verify and owner release approval. Implementation is allowed on the active feature branch only.
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Guardrails
- User explicitly changed the active development scope to Sage/Open Mercato identity export. The prior work-plan gate was updated before writing this active log.
- No Sage database SQL/migration, RLS/grant, stock/FIFO, manufacturing recipe, costing, payments, kitchen printing, cloud queue, Windows agent, sale, purchase, customer or authentication modifications.
- Never connect the two production databases or share their credentials/JWTs. Any export remains from current Sage authenticated user's existing `products.export` access only.
- Require selected branch and forbid cross-branch rows, stale selection, duplicate IDs, invalid IDs and silently truncated exports.
- Preserve original product UUID, branch UUID, SKU/null, original type and active flag. No derived SKU, guessed mapping, price, tax, recipes, costs or inventory in this first contract.
- Do not merge or activate in production without exact-head Full Verify plus distinct owner release approval.

## Baseline
- Sage `main` reconciled at `322348f3d772341cce7484f793dfec94cf0b533b`. No unknown intervening commits at branch creation.
- PR #508 costing read fix merged at that commit, with exact-head green CI and production DB read repair already separately verified.
- PR #507 kitchen atomic handoff merged previously at `693cd639a28fc2655941d6bc26fcd8a8d78f9be3` but the experimental print handoff remains OFF.
- Other open PRs (#505, #492–494) are not made concurrent executable writers.
- Open Mercato already supports `/backend/pos/sage-parity` with a browser-local JSON reader and no production Sage importing; 513 Sage products, all lacking SKU, require native ID preservation.

## Root-cause ledger
- Sage's existing Products Excel export omits `id` and `branch_id`, making trustworthy cross-system identity matching impossible.
- Current Sage product list uses `usePaginatedRows` and `fetchAll`, which inherits branch and search filters. An export must not accidentally represent a partial search, a wrong branch or an incomplete request as a complete branch catalog.
- Sage retains authoritative product/branch identity; Open Mercato has separate catalog IDs and organization concepts. No automatic UUID equivalence.

## Change ledger
1. `8f92019d884e340c4d3a618d44d8562f6a5774e9`: switched unified work plan to the new single writer after explicit owner approval.
2. `981d23c05890cd7458724303fb605eb626188e99`: mandatory active log created under the new single-writer plan.
3. `3cebba05c98cdd831e34e83e012da9e59a9c7943`: versioned, fail-closed, branch-scoped product UUID JSON projection created. No DB calls or writes.
4. `0b24ea97b8376ee30a4a22842018f8fae5511218`: focused identity/scope/no-SKU/privacy unit tests created. Next stage: explicit authorized UI export and completeness verification.
5. `f3fe839d4f3a3302da866c470fc8a987aeb255b1`: added a separate download button in the existing Sage Products page, requiring `products.export`, selected branch and cleared search; captures user/branch/search scope and reports failures without creating a partial file.
6. `80958104276105ce445c40e33b5e75d46627174a`: added read-only snapshot count-vs-data reconciliation with fail-closed scope checks at each await.
7. `730a5224e7523438b052f09dfecedc83af4a52cf`: wired Products download through scope-fenced snapshot service.
8. `daf5d2da609f89457f65c6a7c0965b1a4d9a9be7`: added unit tests for count mismatch, in-flight branch/user change, row limit, RLS error and foreign-branch rows.
9. Draft PR #509 created from the exact reconciled feature branch; final PR-number update is this log-only commit. Next: exact-head CI; no more writes unless the checks identify a real failure.

## Verification ledger
Implemented projection, UI and fetch verification on feature branch. Pending exact-head Jest/unit tests, TypeScript, lint, build and repository full Verify on the committed code. No genuine live Sage export has been downloaded and checked yet. Do not claim source completeness without it.

## Production gate
**HOLD**. This scope approval does not authorize production merge, Supabase writes, migrations, cloud agent changes, live order/print tests or cross-DB sync.

## Next action
Complete the draft PR metadata, run exact-head full CI/Verify and keep the feature out of production until explicit separate release authorization. Confirm an authenticated per-branch download on real Sage data after approval.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل؛ CI يجب أن يفشل إذا اختلف الفرع أو نقص التوثيق؛ لا Merge ولا Production migration قبل التحقق.
