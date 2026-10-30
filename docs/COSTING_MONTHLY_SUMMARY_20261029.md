# Monthly costing summary repeated aggregation
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/costing-monthly-summary-20261029`
Current PR: #549
Last updated: 2026-10-29

## Work status
State: **BLOCKED**
Owner authorizes repair preparation. Production release not yet authorized for this new candidate.

## Guardrails
Single writer, johnas only. No production order/stock/printing test, RLS/permission/role changes, SECURITY DEFINER, new source or persistent cache. Preserve #548 date bounds, fallback fence, completed-product rendering, all stock and accounting writers, online-primary architecture and installed printers. No timeout increase, polling or background jobs.

## Baseline
Maincfd5513409e14df8e4d84152c4e6336b85705eeb, tree1025e221c049e7deed0408d554924af43ab20efe. Live summary definition MD5=679c7dcd64ca10cc594547f3fc65da9e; invoker, STABLE, postgres owner, unchanged authenticated/service ACL and public,pg_temp search path. Monthly branch cardinalities1526/2366 from one indexed count.

## Root-cause ledger
Real UI October01–31 in Smouha and Cleopatra failed at costing_sales_summary SQLSTATE57014 after #548; products remained available. Authenticated EXPLAIN shows an estimate of1 scoped sale and nested downstream cost aggregations. A synthetic complete SQL reproduction confirmed repeated aggregation:30 sales yielded900 aggregate executions; source-fold candidate executes each source once. #548 date-only synthetic benchmark did not model these downstream cost joins and was insufficient to prove monthly report performance.

## Change ledger
Only get_costing_sales_summary changes. Materialize the existing three cost aggregates. Fold base sales and journal/kitchen/legacy costs through one UNION ALL grouped by sale, selecting the first cost by the existing source priority. Aggregate totals directly from that result, eliminating the repeated join back to sales. Keep all source query bodies, rounding, refund/tax formulas, filters, date boundaries, return JSON and privileges. A real zero cost at a higher priority remains authoritative. No sale-count inflation for invoices without any cost. Guarded inverse restores exact #548 summary body.

## Verification ledger
Local complete SQL parity across finite/empty/unbounded/infinite ranges passed on30 mixed invoices, including overlaps and zero sources. Synthetic WASM PostgreSQL:30 sales before39.2ms/max aggregate loops900 versus after0.9ms/loops1;2500 invoices42ms with independently calculated count/net/cost. This is a local minimal schema without production RLS, not live latency proof. New native isolated CI fixture has2500 invoices, actual canonical schema/authenticated RLS, mixed/zero source priorities and runtime aggregate-loop proof. Existing mixed-source full-JSON rollback/reapply/security proof extended; history/date/branch tests retained. Local app/test typechecks, changed-test ESLint, API contract and4 worklog checks passed. The new2500-invoice fixture SQL/bindings and exact guarded migration/rollback were also executed locally against a minimal PostgreSQL schema. Native canonical/RLS execution and final exact-head four-job CI pending. No production candidate applied.

## Production gate
لا Merge ولا Production migration before owner approval of the tested concrete candidate. Recheck original body/security before guarded one-function migration, lock2s/statement15s; verify exact new body and unchanged metadata. Separate post-release read-only October UI proof required in both branches; green synthetic/CI checks alone are insufficient. Rollback restores only summary function; no business history rewritten.

## Next action
Finish focused proof/typechecks/lint, publish one candidate and require exact-head Verify; present concrete release scope after success.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل. CI يجب أن يفشل for branch/log divergence. Keep plan/log and PR ledger current; do not restart healthy CI without changed source. Never count skipped DB tests as passed.
