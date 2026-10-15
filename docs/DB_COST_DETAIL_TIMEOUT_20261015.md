# Database costing detail timeout containment — 2026-10-15
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/costing-detail-timeout-batch-20261015`
Current PR: #508
Last updated: 2026-10-15 Cairo

## Work status
State: **BLOCKED**. Review-only read function proposal. No production SQL.
## Guardrails
No changes to Windows, kitchen, POS transactions, warehouse, stock, FIFO, accounting records, access grants or permissions; preserve cross-branch isolation.
## Baseline
Main `693cd639a28fc2655941d6bc26fcd8a8d78f9be3`. Screenshot reveals timeout toast despite visible rows.
## Root-cause ledger
At 06:01 and 06:05 UTC 2026-10-15 seven /costing TIMEOUT_ERROR reports. Production Postgres logs SQLSTATE 57014 in get_product_costing_detail via _raw_cost_context_for_costing -> get_raw_material_current_prices -> private.financial_row_visible. In 11-min window: 3 HTTP 500s averaging ~8224ms and 3 successful detail requests. 24h saw 45 PostgreSQL 57014 cancellations across multiple endpoints (POS, cloud print, dashboard, costing). This is a specific contributor, not a global fix.
## Change ledger
`scripts/experiments/get_product_costing_detail_batch_prices_PROPOSAL_20261015.sql`: same product-detail SQL with strict Smouha-only `IF v_scope = '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid` gate; original SQL preserved verbatim in ELSE, but ONE branch-scoped, DISTINCT raw-id array price resolver evaluated as MATERIALIZED CTE. Empty array is `'{}'::uuid[]` not null, to avoid full price scan. Keep response JSON fields and all auth guards.
## Verification ledger
Integration test compares exact JSON before/after candidate for authorized/unauthorized, recipe/no recipe and absent products, with rollback-only savepoint. On 2026-10-15: user approved a limited safely reversible Smoha pilot. Re-run exact-head CI on gated branch-swap parity test. Prior global trial test alone does not prove the branch gate. Await representative latency, snapshot original function, zero backpressure/DDL lock budget and monitored rollback.
## Production gate
BLOCKED pending tests and measured speed. Owner approved Smoha-only gated pilot but NOT global cross-branch function changes. Never silently apply before gates. Preserve old live function until parity and representative benchmark; review global 57014 separately. Any approved future function replacement needs short lock_timeout and verified rollback.
## Next action
Verify CI for draft PR, inspect failing tests, evaluate safe deployment only after fully green.
## Mandatory update protocol
السجل هو المرجع الإجباري للعمل؛ CI يجب أن يفشل إذا اختلف الفرع أو نقص التوثيق؛ لا Merge ولا Production migration قبل التحقق.
