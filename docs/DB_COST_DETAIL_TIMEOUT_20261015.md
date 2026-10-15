# Database costing timeout repair — 2026-10-15
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/costing-detail-timeout-batch-20261015`
Current PR: #508
Last updated: 2026-10-15 10:20 Cairo / 07:20 UTC

## Work status
State: **DEPLOYED** for the verified database read repair in both Smouha and Cleopatra, applied at 07:18:59 UTC. GitHub merge/publish remains subject to exact-head checks. This is not proof that every historical timeout is cured or that peak-load latency has been measured.

## Guardrails
Preserve complete costing JSON, raw-price precedence, full-precision sums and final rounding, null/empty/manufactured fallback, permissions and branch isolation. No business data, table, constraint, RLS, ACL, FIFO, inventory, accounting, settlement, sale, kitchen-send, queue-write or Windows agent changes. Existing SECURITY DEFINER modes are retained, never added as a permission workaround. Kitchen print handoff remains OFF.

## Baseline
Main and deployed app before this work: `693cd639a28fc2655941d6bc26fcd8a8d78f9be3`; deployment run `38678488570` and main verification `38678488551` succeeded.
PR resumed at `67764021c527a5bba97347d8160dfa14d5b3541b`, whose four CI suites had completed successfully (`38694067326`). Contrary to the initial handoff, production already had the Smouha-only pilot installed at 06:39:08 UTC, MD5 `59cff14b68b5eaf49f648bdc49ba1568`; the pre-pilot original was `666844cc8f86f35152828e9ff799031b`. The original recipe-helper MD5 was `756e10880d1cbcc18d56daf482062206`.

## Root-cause ledger
Repeated `_raw_cost_context_for_costing` calls evaluated the same raw-price history and financial visibility checks per line and per output field. The detail also calculates actual and theoretical costs through `_product_recipe_cost` (the BOM helper delegates to it), and that helper still resolved prices separately per raw line. The repair batches both layers without replacing their pricing source.
Broader 24h PostgreSQL 57014 included POS, print, order and dashboard requests, with a burst before the receipt/open-check and print-alert indexes were installed at 2026-10-14 18:43/18:44 UTC. Both indexes are valid/ready and cover both branches. Do not attribute those older incidents to this new release.

## Change ledger
- `_product_recipe_cost(uuid,uuid)`: MATERIALIZED raw lines and one DISTINCT raw-id array price resolution per call; retain the original CASE, numeric multiplication, final SUM/round, empty manufactured group and no-recipe fallback. New MD5 `8b0bc11afaab1a9a967589aa90159e55`.
- `get_product_costing_detail(uuid,uuid)`: one MATERIALIZED batch for detail price fields, explicitly enabled for Smouha `19c3fd23-d784-455b-8840-f4f2ac619651` and Cleopatra `279e6662-e901-40b2-9170-7dda0b471ba7`. Retain the legacy ELSE for any other branch, all response fields and auth guards. New MD5 `732777a33b67f9a6c1da8de4fa0a0431`.
- Applied migration: `20261015071859_costing_detail_two_branch_batch_read`; canonical portable function definitions use the SAME version returned by production, replacing the earlier unshipped local filename. Do not apply an equivalent second migration. Live installation additionally checked exact old/new function hashes, kitchen/print baseline hashes and denied anonymous/internal-helper grants in the transaction; lock_timeout=300ms, statement_timeout=2500ms. Preflight had zero long client queries or lock waiters.
- A missing function terminator in the first local CI migration candidate failed before any production application and was corrected. The final source and recovery rehearsal passed before release.

## Verification ledger
Exact functional/recovery head `a068a58f5c39bd4893e9cc45134b9da9a5bb7630`: full Verify main `38697228401` SUCCESS in all four suites: app, 1068 DB integration/security tests, Chromium and Pages continuity. Fast Verify `38697223364` also passed; 16 product-costing tests include full JSON parity against original SQL, second-branch positive/null-scope reads, reciprocal denials, missing prices, empty groups and actual guarded rollback execution. Local mandatory-log/costing contract tests: 14 passed. No fixture or test order was written to production.
Production read-only comparisons: 20 distinct Chicken Fajita raw prices per branch matched original price/source/time/reference/detail exactly; full helper estimates matched in both branches. Helpers were tested in their existing definer execution context, without granting helper execution to authenticated users.

Immediate same-user production RPC measurements (server execution only, not network or paper):

| Branch / product | Before ms | After ms | Parity |
| --- | ---: | ---: | --- |
| Smouha / Avocado | 1280 | 290 | identical complete JSON, MD5 f3608481ea599d13e4804e4d9a088f9c |
| Cleopatra / Avocado | 2467 | 231 | identical complete JSON, MD5 2d2d1cbbd8737b3edc3cf8c9b0e6ded6 |
| Smouha / Chicken Fajita, 22 lines | 3222 | 253 | identical complete JSON, MD5 76aa40b72dd9caf47578beab90bab619 |
| Cleopatra / Chicken Fajita, 22 lines | >6500 safety cutoff | 304 | original helper cost hash 591500e2035070b925e49f226dea3dac retained; 20 raw contexts identical; full old response unavailable because of timeout |

The Cleopatra cutoff and the earlier denied direct-helper diagnostic are assistant tests, not customer incidents. Do not claim old complete JSON parity for the timed-out Cleopatra heavy request.
Post-apply signatures, volatility, search_path and ACL retained. `send_to_kitchen` MD5 `1ab4553a87e353c7478c0343973e865f`, print claim `230529255ab7fe21df1eb1ca0f07f1b6`, open-order print state `c0651d6504587d2ecc6cb2ae257d5da1` unchanged.
Real traffic before this application (06:39:09–07:01 UTC): orders 24 calls p95 323ms; cloud jobs 14 calls p95 270ms; print claim 11 calls p95 509ms; open-order print state 7 calls p95 158ms; dashboard 6 calls p95 689ms; no HTTP 5xx in these groups. No costing-detail user calls in that interval. These are limited samples, not peak-load proof.

## Production gate
Database rollout is applied and the immediate data/performance checks passed for both branches. No print rollout activation, order replay or printer tests. Merge/publish requires final exact-head checks; post-merge verification must also pass. Check real traffic after release separately and never claim physical paper from submitted state alone.

## Next action
Finish final documentation/migration-version verification, merge/publish after green, and inspect post-release real traffic for both branches. Preserve the existing 8-second authenticated timeout. If a cost mismatch or attributable latency/error regression is proven, run the guarded recovery below; do not blindly revert unrelated application writes or change another project.

## Recovery
`scripts/rollback/costing_batch_restore_smouha_pilot_20261015.sql` restores BOTH original recipe helper and the last-known Smouha-only detail pilot in a single short-lock transaction, guards against source drift, then verifies original hashes. This exact script was rehearsed inside a rollback-only CI savepoint. Individual snapshots and the original pre-pilot detail source are retained. The assistant is not a continuously running production monitor after this turn.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل؛ CI يجب أن يفشل إذا اختلف الفرع أو نقص التوثيق؛ لا Merge ولا Production migration قبل التحقق.
