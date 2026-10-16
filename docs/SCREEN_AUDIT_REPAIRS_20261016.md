# Screen audit repairs — 2026-10-16

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/screen-audit-repairs-20261016`
Current PR: #517
Last updated: 2026-10-16 17:38 Africa/Cairo
State: **BLOCKED**

## Guardrails
Frontend-only. Preserve recipe quantities and save payloads, current prices, stock/FIFO, sale/payment writers, kitchen tickets, print routing, Windows agents and existing authorizations. No production data or schema changes. Cashier-area routing deferred by owner.

## Baseline
Reconciled main `32562318d23dccd7ab91034ab38b29098efc882d`: #516 removes only the mistaken JSON export; preserve Gregorian dates and latest-price releases.

## Root-cause ledger
- Raw material search filters only loaded pages; use existing server search with unchanged page size and branch scope.
- Recipe editor omits raw material measurement units; quantities must remain unchanged pending business review (150 kg must not silently become 150 g).
- Low stock summary SQL returns a TABLE/array, but page reads object properties. Derive counts from the same full alert rows and remove duplicate summary SQL read.
- Procurement payables link opens default customer tab; link to supplier tab explicitly.
- Aging cards omit the existing 31–60 day bucket.

## Change ledger
Implemented bounded debounced server search (100 rows + existing lookahead), measurement-unit metadata in the existing editor read, labels for existing/new recipe quantities without conversions, counts derived from canonical alert rows with stale-response rejection, supplier URL tab navigation and missing aging bucket cards. No production changes.

## Verification ledger
Local application/test typecheck, full lint (0 errors; 13 existing warnings), API contract and build passed. Initial new test fixtures needed stable mock translation identity, treasury-read mock and an accessible table-cell selector; production code was not weakened. Focused behavioral regressions pass after fixture corrections. Initial full suite: 1794 passed / 2 failed (new raw-search test matched hidden filter/mobile markup instead of accessible table cells). Corrected the test selector; all 10 focused tests pass. Final exact-head Full Verify pending.

## Production gate
BLOCKED: no production merge/deploy approval for this batch. Changes use shared pages for both branches. No live sale, recipe save or print test.

## Next action
Implement bounded search, unit labels, shared-source counters and supplier navigation; verify the batch and present its PR for review.

## Mandatory update protocol
Keep this log and CURRENT_WORK_PLAN aligned before every code batch. Single writer; reconcile unexpected HEAD movement. Record exact-head checks and failures. Roll back this frontend batch via its isolated merge only if an approved deployment regresses; never replay operational jobs.
