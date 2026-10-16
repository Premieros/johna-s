# Selective repair: remove mistaken Sage ↔ Open Mercato JSON export from Johna's
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/remove-mistaken-sage-identity-export-20261016`
Baseline main: `184933269a10315ace4f97188edef1c676f23735` (#515)
Current PR: #516
Last updated: 2026-10-16

## Work status
State: **BLOCKED** — review-only removal; NO MERGE / NO DEPLOY
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Guardrails
- Strictly code-only; delete the accidental #509 JSON export and its exclusive tests. No database or network write, migration, inventory, sale, costing or printing change.
- Keep all later main commits (#510–#515). No release without explicit owner approval.

## Owner intent
Owner explicitly identified the accidental #509 changes to Johna's and authorized **preparation of a precise code removal** after the already-current merge, without any production merge or deployment. Do not misinterpret this as permission to revert all of Johna's or to transfer data to `Premieros/.com`.

## Baseline

## Root-cause ledger
- The #509 export was built in the **wrong project**; the intended target is Premieros/.com, not Johna's.
- Broad rollback would lose independent later fixes and is disallowed. Selective removal is the safe approach.

## Baseline, audit and known boundaries
- #509 merged at `6e4792e38c6a62aa4446a1976fb93b8b23ebc973`. Its seven touched paths: `docs/CURRENT_WORK_PLAN.md`, `docs/SAGE_OPENMERCATO_IDENTITY_EXPORT_20261015.md`, `src/features/catalog/pages/ProductsPage.tsx`, two new code modules and two new dedicated tests.
- Since #509, #510–#515 made independent changes to production. NEVER revert main to an older SHA. #515 was merged in `184933269a10315ace4f97188edef1c676f23735`; Verify `38895952188` and Pages `38895952203` succeeded.
- The canonical database remains `azzdesuowpdcoflmyezn`. **No Supabase SQL write or schema migration permitted.**
- The active #515 Gregorian dates track has completed. This owner-approved corrective scope is now the sole active writer, recorded in `docs/CURRENT_WORK_PLAN.md` first.

## Intended patch — minimal
1. In the *current* ProductsPage, remove ONLY the additional `useAuth` hook, mistaken JSON identity export service import, scope/busy state, `handleIdentityExport` handler, JSON identity button and its helper caption. Preserve original `handleExport` for Excel, `handleImport`, branch filters, manufacturing, inventory, prices and ALL later changes.
2. Delete exactly these four #509-only files, provided no unrelated references exist:
   - `src/features/catalog/lib/sageCatalogIdentityExport.ts`
   - `src/features/catalog/services/sageIdentitySnapshot.ts`
   - `tests/unit/sageCatalogIdentityExport.test.ts`
   - `tests/unit/sageIdentitySnapshot.test.ts`
3. Keep `docs/SAGE_OPENMERCATO_IDENTITY_EXPORT_20261015.md` as **historical audit only**, never as active work. Preserve all other project docs and CI history.
4. Update this active log and keep the PR in **Draft** with an exact diff review.

## Verification ledger
- Draft PR #516 opened at `3693c44c9c2dd1992613a6a5b57371712c489d4a` (current head before this log correction). Branch diff restricted to two documentation files, original ProductsPage removal, and deletion of four #509-only modules/tests.
- First full PR Verify `38898051206` failed mandatory active worklog structural test because required headings/state metadata were missing; corrective log-only commit now aligns with the repository contract. Fast Verify and remaining full checks must rerun on new exact head.
- No evidence of new production activity or database writes from this correction; no authenticated real-world regression walkthrough has been claimed.

## Production gate
**HOLD**. No production merge or deployment without distinct explicit approval following successful exact-head Full Verify, architecture/security, DB/RLS, browser, and continuity checks. Do not touch stock, sales, accounting, kitchens, costing, printing or any data.

## Change ledger
1. `71936770fc648c68d8369b1c6d5171c39e6c8374`: changed current work plan FIRST, after verifying #515 merged and complete; new active sole writer identified.
2. `7a98e70bd33ef689321ca344792b423a9b818881`: created mandatory single-writer correction log.
3. `23cc31caa5e14d540ebd8de5c0e4f5a07c52c7e3`: removed only the #509 identity UI/hook/handler from the *latest* ProductsPage, preserving the original Excel import/export and all post-#509 product functionality.
4. Removed the #509-only service via `8f87f48352db3edb596afd75b43c54378d31f070`.
5. Removed the #509-only projection module via `287aa0942aa87e694dd6b4377cedb35b88971a1f`.
6. Removed the #509-only service unit tests via `63a43726de4ecb6ec19e2dfa29289b29daac4d15`.
7. Removed the #509-only projection unit tests via `12c38155ad67b2c09bd11750bf276a5d5ecbd3ce`.
8. The exported JSON feature has no runtime or unit-test code remaining in this branch. Historic PR #509 evidence stays unmodified. Next step: exact diff review and CI on a Draft PR; no merge/deployment.

## Verification ledger
Runtime additions removed; awaiting exact diff review and exact-head Full Verify after opening Draft PR. NO production release authorization.

## Next action
Wait for new exact-head Full Verify, DB/RLS and browser-smoke and independent diff review. Keep #516 Draft and never merge/deploy without owner release authorization.

## Mandatory update protocol
This log is mandatory for the active single writer. السجل هو المرجع الإجباري للعمل؛ CI يجب أن يفشل عند اختلاف النطاق؛ لا Merge ولا Production migration قبل التحقق وموافقة منفصلة.
