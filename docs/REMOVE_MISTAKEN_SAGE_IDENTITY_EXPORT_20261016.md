# Selective repair: remove mistaken Sage ↔ Open Mercato JSON export from Johna's
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/remove-mistaken-sage-identity-export-20261016`
Baseline main: `184933269a10315ace4f97188edef1c676f23735` (#515)
Current PR: PENDING
Date: 2026-10-16

## Work status
State: **STAGED FOR REVIEW ONLY / NO MERGE / NO DEPLOY**
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Owner intent
Owner explicitly identified the accidental #509 changes to Johna's and authorized **preparation of a precise code removal** after the already-current merge, without any production merge or deployment. Do not misinterpret this as permission to revert all of Johna's or to transfer data to `Premieros/.com`.

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

## Production gate
**HOLD**. No production merge or deployment without distinct explicit approval following successful exact-head Full Verify, architecture/security, DB/RLS, browser, and continuity checks. Do not touch stock, sales, accounting, kitchens, costing, printing or any data.

## Change ledger
1. `71936770fc648c68d8369b1c6d5171c39e6c8374`: changed current work plan FIRST, after verifying #515 merged and complete; new active sole writer identified.
2. `7a98e70bd33ef689321ca344792b423a9b818881`: created mandatory single-writer correction log.
3. `23cc31caa5e14d540ebd8de5c0e4f5a07c52c7e3`: removed only the #509 identity UI/hook/handler from the *latest* ProductsPage, preserving the original Excel import/export and all post-#509 product functionality. Identity-only helper modules still pending deletion.

## Verification ledger
Pending focused diff, exact-head automated checks and PR review. Not yet safe to deploy.
