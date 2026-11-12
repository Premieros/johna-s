# Screen audit repairs — 2026-10-16

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/screen-audit-repairs-20261016`
Current PR: #517
Last updated: 2026-10-16 18:06 Africa/Cairo
State: **BLOCKED**

## Guardrails
Owner expanded scope at 17:47 Cairo to adding areas with a chosen table count, clarified as capability rather than copying live branch data. Stage a new invoker RPC composing existing authorized table creation atomically, and the area-count form. No production apply without approval. Preserve recipe quantities and save payloads, current prices, stock/FIFO, sale/payment writers, kitchen tickets, print routing, Windows agents and existing authorizations. Only the additive RPC was applied after owner approval; no configuration or operational rows were changed. Cashier-area routing deferred by owner.

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
Owner explicitly approved migration + merge + deployment at 2026-10-16 18:04 Cairo.
Applied exact tested SQL to production as Supabase version `20261016150535_floor_plan_create_area_with_tables` (renamed source from CLI-generated version only; SQL sha256 unchanged `12459f4b15530122b39197d45505e31e6836a48cb719a27333935b10722a35ca`). No live area/table rows created. New prosrc MD5 `1e60aaf69dc3ea2a86a9713b4a0886ab`, invoker, authenticated EXECUTE only, anon denied; unauthenticated call returns AUTH_REQUIRED before writes. Existing add-table MD5 `e8834a75b801ea9d89aa38ed4b29d996`, all other public/private functions+ACL fingerprint `bd9aee58884003832e3654634679a3d8`, policies `93c98d7dd276c70f4c17ef811756e38a`, triggers `94a04037d378e72813ebb03c2c6bdcd1` unchanged before/after.
Frozen functional head c8690ec5 Full Verify38920015169 all4 jobs SUCCESS:1805 app/1087 DB/134 Chromium, including6 new transactional area tests. Prior WAL benchmark failure recorded above; same bound passed with baseline median56803/candidate54978 and diagnostic variability between identical baseline repetitions. This is not a claim that benchmark methodology is hardened.
BLOCKED only pending exact-head verification after migration-version reconciliation; approval is already granted. Do not reapply this migration or create a duplicate version. Changes use shared pages for both branches. No live sale, recipe save or print test.

## Next action
Run Full Verify on the reconciled exact head, merge with expected-head fence, watch deploy + postmerge suites and verify the live UI without saving configuration or operational transactions. Approval already granted; do not request it again.

## Mandatory update protocol
Keep this log and CURRENT_WORK_PLAN aligned before every code batch. Single writer; reconcile unexpected HEAD movement. Record exact-head checks and failures. If an approved rollout regresses, restore the prior frontend; leave any newly-created area/table records intact. The additive RPC can remain unused during rollback; never delete configuration or modify historical order identities. never replay operational jobs.
