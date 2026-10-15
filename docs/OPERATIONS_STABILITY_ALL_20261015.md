# Both-branch operational stability repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/operations-stability-all-20261015`
Current PR: #510
Last updated: 2026-10-15 Cairo

## Work status
State: **BLOCKED** pending exact-head full verification, rollback rehearsal and bounded production comparison.
Execution mode: **SINGLE_WRITER**; sequential writes only. Unexpected HEAD: stop and reconcile.

## Guardrails
Owner says “اصلح الجميع”: fix verified failures for Smouha and Cleopatra. Preserve authorization, branch/station isolation, money, FIFO precedence, stock/sale/void semantics and print idempotency. No broader KDS permissions, new security-definer bypass, speculative indexes, live order/print fixtures, historical job replay, Windows installation or #507 activation. Preserve #509 identity export.

## Baseline
Main `6e4792e38c6a62aa4446a1976fb93b8b23ebc973`. Cost detail `732777a33b67f9a6c1da8de4fa0a0431` and recipe helper `8b0bc11afaab1a9a967589aa90159e55` retained. Kitchen handoff server OFF. Live original functions captured in `scripts/rollback/operations_stability_original_functions_20261015.sql`; migration pins their three MD5 hashes. V7 claim/start/complete/permission contracts remain frozen.

## Root-cause ledger
- 292 KDS `pos.order.edit` errors; both real kitchen roles have kds_update, no broad edit. Trigger recognizes changed status, but rejects repeated status kitchen timestamp updates.
- Smouha PostgreSQL 57014 traces include update_order temporary matched-ID DDL/schema watcher and negative-stock last-known FIFO price read. Other traces include queue, repricing and served baseline; these remain separate monitoring targets, not proof that #508 failed.
- Last-known FIFO source UNION eagerly resolves all four sources before priority selection; each source independently returns at most one positive cost.
- Closing report already fetches actual/estimated raw consumption; automatic thermal TEXT renderer omits it while HTML/A4 includes it.
- Client audit inserts omit branch_id and ignore returned errors; shift close awaits extra remote getUser before enqueueing its report.
- Smouha afternoon print wait p95 11.05s versus Cleopatra 1.27s. Both-branch DB wake trigger, publication and branch RLS are present; no pending jobs at inspection, all 286 afternoon jobs submitted with attempts=1. Windows version/config cannot be proved from server sessions. Do not alter RPC contracts or pretend a client repair was installed.

## Change ledger
- Narrow same-status KDS bookkeeping exception restricted to kds_update, accessible branch/station and kitchen-only fields.
- Same source SQL predicates/order and numeric output; lazy COALESCE of four existing single-row FIFO source reads. No inventory writer/index changes.
- update_order matched-ID temporary relation replaced by an initially empty per-call UUID array; all identity/sent-quantity checks and existing transaction/row locks retained. No temporary schema notification for matching.
- Thermal text includes per-material quantity/unit, actual and estimated costs and total displayed cost, without changing drawer math or job identity.
- Client audit accepts operation branch, shift open/close pass exact branch, daily close uses existing details.branch_id. Local session identity, RLS retained, sanitized insert-error warning. Other unscoped legacy audit callers are not claimed repaired.

## Verification ledger
1,793 frontend tests passed; application/test TypeScript, changed-file lint and API contract passed. First full run 38781292977 stopped at the baseline guard: canonical update_order has the same SQL with different comments/layout from production. Pin both exact source-body hashes, with a token/literal equivalence test; no CI bypass. New DB tests cover repeated cooking/ready/served without edit/send permission, denied business edits, branch/station denial, source precedence, oversold exclusions, warehouse boundaries, duplicate line matching and original-function rollback parity. Exact-head DB/browser proof pending. No production changes yet.

Bounded live read-only old/candidate comparisons: three material/branch/warehouse contexts returned exactly 0, 5.250000 and 12.430000 for both. Three alternating EXPLAIN samples per reader/context: Smouha priced read median 8.769→4.875ms, buffer hits 1969→886; Cleopatra 1.492→1.141ms, hits 380→180. Unpriced fallback scans all sources as before (2165→2159 hits), timings noisy ~9ms. No peak-load or overall FIFO timeout cure is claimed.

## Production gate
No Merge ولا Production migration before exact-head Full Verify, observed parity/performance and safe rollback. User has authorized fixing all verified problems; do not request redundant routine permission. A passing unit suite is not evidence of deployed stability. Claim/start/complete signatures and fingerprints must remain untouched.

## Next action
Complete tests and open draft PR, run full CI, compare bounded live read-only original/candidate prices and security metadata, then apply verified migration/release and monitor. Establish installed-agent evidence before any Windows-specific remediation.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل؛ CI يجب أن يفشل إذا اختلف الفرع أو نقص التوثيق؛ لا Merge ولا Production migration قبل التحقق. Record every change/check and reconcile HEAD before sequential publication.
