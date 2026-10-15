# Database costing detail timeout containment — 2026-10-15
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/costing-detail-timeout-batch-20261015`
Current PR: #508
Last updated: 2026-10-15 Cairo

## Work status
State: **BLOCKED** for expansion beyond Smouha and for claiming a global cure. Authorized Smouha-only read-function pilot ACTIVE in production, installed 2026-10-15 06:39:08 UTC; existing formula is retained for all other branches. Safe rollback captured below.
## Guardrails
No changes to Windows, kitchen, POS transactions, warehouse, stock, FIFO, accounting records, access grants or permissions; preserve cross-branch isolation.
## Baseline
Main `693cd639a28fc2655941d6bc26fcd8a8d78f9be3`. Screenshot reveals timeout toast despite visible rows.
## Root-cause ledger
At 06:01 and 06:05 UTC 2026-10-15 seven /costing TIMEOUT_ERROR reports. Production Postgres logs SQLSTATE 57014 in get_product_costing_detail via _raw_cost_context_for_costing -> get_raw_material_current_prices -> private.financial_row_visible. In 11-min window: 3 HTTP 500s averaging ~8224ms and 3 successful detail requests. 24h saw 45 PostgreSQL 57014 cancellations across multiple endpoints (POS, cloud print, dashboard, costing). This is a specific contributor, not a global fix.
## Change ledger
`scripts/experiments/get_product_costing_detail_batch_prices_PROPOSAL_20261015.sql`: same product-detail SQL with strict Smouha-only `IF v_scope = '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid` gate; original SQL preserved verbatim in ELSE, but ONE branch-scoped, DISTINCT raw-id array price resolver evaluated as MATERIALIZED CTE. Empty array is `'{}'::uuid[]` not null, to avoid full price scan. Keep response JSON fields and all auth guards.
## Verification ledger
Owner authorized limited revertible Smouha-only release. Exact-head d8f0aaad full CI run 38692765646: 4/4 SUCCESS including db, 13/13 modified product-costing parity tests, browser, app, and pages-continuity. Production baseline function MD5 666844cc8f86f35152828e9ff799031b, deployed scoped variant MD5 59cff14b68b5eaf49f648bdc49ba1568. Rollback file byte-identical to baseline.
At deployment, zero long business transactions or lock waiters; first SQL statement had only a missing terminator and was rolled back without changing baseline; corrected application committed with transactional lock_timeout=300ms/statement_timeout=2500ms. Verified original SECURITY DEFINER/STABLE/search_path grants retained; anon denied.
Authenticated SAME-user Smoha read checks, 6500ms safety: Avocado before 3147ms, after 1131ms, FULL JSON md5 same f3608481ea599d13e4804e4d9a088f9c; Chicken Fajita with 22 raw lines before 6500ms timeout, after 3480ms success. At 06:41:43 UTC zero new Smouha timeout telemetry, blocked queries, or long business queries; log sample after deployment had zero HTTP 500 and 57014 but ALSO zero user PostgREST costing calls, so NO proof under live peak traffic. Global POS/print/report 57014 remains OUT OF SCOPE.
## Production gate
Expansion BLOCKED. Smouha-only read pilot is live, not full cure. No global promotion before representative real-traffic monitoring. If timeout or data mismatch is observed, restore exact backup SQL within short-lock-timeout transaction and verify baseline MD5. Never replay POS orders or touch print agents. Preserve old live function until parity and representative benchmark; review global 57014 separately. Rollback source: `scripts/rollback/get_product_costing_detail_original_20261015.sql` (live pre-change pg_get_functiondef, MD5 `666844cc8f86f35152828e9ff799031b`). Any future function replacement needs short lock_timeout and verified restoration of that MD5.
## Next action
Observe real Smouha costing-detail requests and unrelated global 57014 separately; revert this read-only function if it worsens errors/cost parity. Keep draft PR unmerged pending live-traffic evidence; do not infer cure of all pages.

## Resumed verification — 2026-10-15 07:02 UTC
- Owner now authorizes safe scope expansion to both existing branches after independent verification. Live source confirms the Smouha-only pilot hash above, not the legacy function. Main is still `693cd639a28fc2655941d6bc26fcd8a8d78f9be3`; exact-head Verify main `38694067326` finished success, all four suites.
- Cleopatra is `279e6662-e901-40b2-9170-7dda0b471ba7`; Smouha is `19c3fd23-d784-455b-8840-f4f2ac619651`. Print handoff rollout remains `enabled=false`, expired; no gate or dispatcher change is proposed.
- Separate recovery snapshot: `scripts/rollback/get_product_costing_detail_smouha_pilot_20261015.sql`, live pilot hash `59cff14b68b5eaf49f648bdc49ba1568`. Original pre-pilot rollback is also retained.
- Read-only authenticated Cleopatra baseline: Avocado (5 raw lines) 2490ms, JSON MD5 `2d2d1cbbd8737b3edc3cf8c9b0e6ded6`; Chicken Fajita (22 raw lines) exceeded the deliberately lower 6500ms safety cutoff. This cancellation is an assistant diagnostic, not a new customer incident.
- The broad 24h timeouts include a burst before the receipt and print-alert read indexes were installed at 2026-10-14 18:43/18:44 UTC. Both indexes are now valid/ready and cover both branches. They must not be attributed to this new costing change.
- Real traffic 06:39:09–07:01 UTC: orders 24 calls, p95 323ms; cloud_print_jobs 14 calls, p95 270ms; claim_cloud_print_jobs 11 calls, p95 509ms; open-order print state 7 calls, p95 158ms; dashboard snapshot 6 calls, p95 689ms. No HTTP 5xx in these groups. There were no costing detail requests: no peak-load claim is justified.
- Candidate now explicitly allowlists both branches, retaining the original ELSE for any future branch. Added second-branch positive recipe JSON parity, omitted-branch scope and reciprocal denial coverage. Canonical migration `20261015070108_costing_detail_two_branch_batch_read.sql` is PREPARED, NOT APPLIED. Release is blocked until candidate verification and branch-specific live read parity/performance.
- Follow-up source review: `_product_bom_cost` delegates verbatim to `_product_recipe_cost`, so detail computes the recipe estimate twice, and that helper still calls the same single-raw price resolver per recipe line. Candidate additionally batches that internal read while preserving the helper's null/empty/manufactured fallback, full-precision sum and final rounding. Original helper snapshot hash `756e10880d1cbcc18d56daf482062206`, stored in `scripts/rollback/product_recipe_cost_original_20261015.sql`; no ACL, language, volatility or security-mode changes. It is only referenced by the product detail and BOM-cost helper in live function source. Added full-response parity against the original helper, including missing-price and empty-group cases; final exact-head CI must pass again.
## Mandatory update protocol
السجل هو المرجع الإجباري للعمل؛ CI يجب أن يفشل إذا اختلف الفرع أو نقص التوثيق؛ لا Merge ولا Production migration قبل التحقق.
