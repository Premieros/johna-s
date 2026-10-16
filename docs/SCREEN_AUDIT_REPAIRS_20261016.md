# Screen audit repairs — 2026-10-16

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/screen-audit-repairs-20261016`
Current PR: #517
Last updated: 2026-10-16 17:57 Africa/Cairo
State: **BLOCKED**

## Guardrails
Owner expanded scope at 17:47 Cairo to adding areas with a chosen table count, clarified as capability rather than copying live branch data. Stage a new invoker RPC composing existing authorized table creation atomically, and the area-count form. No production apply without approval. Preserve recipe quantities and save payloads, current prices, stock/FIFO, sale/payment writers, kitchen tickets, print routing, Windows agents and existing authorizations. No production data or schema changes have been applied. Cashier-area routing deferred by owner.

## Baseline
Reconciled main `32562318d23dccd7ab91034ab38b29098efc882d`: #516 removes only the mistaken JSON export; preserve Gregorian dates and latest-price releases.

## Root-cause ledger
- Raw material search filters only loaded pages; use existing server search with unchanged page size and branch scope.
- Recipe editor omits raw material measurement units; quantities must remain unchanged pending business review (150 kg must not silently become 150 g).
- Low stock summary SQL returns a TABLE/array, but page reads object properties. Derive counts from the same full alert rows and remove duplicate summary SQL read.
- Procurement payables link opens default customer tab; link to supplier tab explicitly.
- Aging cards omit the existing 31–60 day bucket.
- Area creation accepts only a name; tables require individual requests. Add a bounded count to atomic creation without modifying existing areas or tables.

## Change ledger
Implemented bounded debounced server search (100 rows + existing lookahead), measurement-unit metadata in the existing editor read, labels for existing/new recipe quantities without conversions, counts derived from canonical alert rows with stale-response rejection, supplier URL tab navigation and missing aging bucket cards. Added floor_plan_create_area_with_tables (SECURITY INVOKER, authenticated-only): caller RLS inserts a nondefault area, existing permission-first floor_plan_add_table creates 0–100 prefixed tables in the same transaction; any table failure raises and rolls back the entire operation. No existing function, policy, constraint or operational data is changed. Form blocks duplicate submission and rejects stale branch completion. CLI 2.121.0 created migration 20261016145256 with telemetry explicitly disabled.

Added WAL bytes/records/FPI/dirtied diagnostics before the unchanged 5% assertion; no threshold or source-price behavior changes. No production changes.

## Verification ledger
Local application/test typecheck, full lint (0 errors; 13 existing warnings), API contract and build passed. Initial new test fixtures needed stable mock translation identity, treasury-read mock and an accessible table-cell selector; production code was not weakened. Focused behavioral regressions pass after fixture corrections. Initial full suite: 1794 passed / 2 failed (new raw-search test matched hidden filter/mobile markup instead of accessible table cells). Corrected the test selector; all 10 focused tests pass. Head 0d584a59 Full Verify: app 1798 passed, Chromium 134 passed, Pages continuity success; DB 1080 passed / 1 failed unchanged FIFO WAL comparison (58410 > 57495.9), repeated from #515. Do not rerun until green or weaken the bound; add diagnostic evidence for investigation.

New scope: 47 focused tests passed; fresh typechecks/lint and full exact-head verification pending. Integration tests cover 0/1/100 counts, both branches, permission/branch denial, name collisions with full rollback, existing Main Area preservation and invoker/anon ACL.

## Production gate
BLOCKED: no production merge/deploy approval for this batch. Changes use shared pages for both branches. No live sale, recipe save or print test.

## Next action
Run Full Verify on the expanded exact head; inspect WAL diagnostics whether it passes or fails. Present the reviewed RPC migration and frontend for separate owner rollout approval.

## Mandatory update protocol
Keep this log and CURRENT_WORK_PLAN aligned before every code batch. Single writer; reconcile unexpected HEAD movement. Record exact-head checks and failures. If an approved rollout regresses, restore the prior frontend; leave any newly-created area/table records intact. The additive RPC can remain unused during rollback; never delete configuration or modify historical order identities. never replay operational jobs.
