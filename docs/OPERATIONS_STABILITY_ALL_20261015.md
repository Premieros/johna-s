# Both-branch operational stability repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/operations-stability-all-20261015`
Current PR: #510
Last updated: 2026-10-15 Cairo

## Work status
State: **DEPLOYED** in production after exact-head verification, rollback rehearsal and explicit owner reapproval; source reconciliation/CI and natural-traffic observation continue.
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
- Canonical migration filename is aligned with the authoritative applied Supabase version `20261015183017`; SQL bytes remain identical to the preapproved tested source (previous staging filename20261015174807). No remote history editing or SQL reapplication.
- Narrow same-status KDS bookkeeping exception restricted to kds_update, accessible branch/station and kitchen-only fields.
- Same source SQL predicates/order and numeric output; lazy COALESCE of four existing single-row FIFO source reads. No inventory writer/index changes.
- update_order matched-ID temporary relation replaced by an initially empty per-call UUID array; all identity/sent-quantity checks and existing transaction/row locks retained. No temporary schema notification for matching.
- Thermal text includes per-material quantity/unit, actual and estimated costs and total displayed cost, without changing drawer math or job identity.
- Client audit accepts operation branch, shift open/close pass exact branch, daily close uses existing details.branch_id. Local session identity, RLS retained, sanitized insert-error warning. Other unscoped legacy audit callers are not claimed repaired.
- Queue the automatic idempotent closing report before optional client audit I/O, so audit latency cannot delay report creation.

## Verification ledger
Exact source `4326b17c91864af088544ff9466035c69bb74c38`, Full Verify 38782209302 SUCCESS:1795 frontend,1071 DB/security/RLS,132 Chromium tests; Fast Verify 38782196520 SUCCESS. Covers repeated cooking/ready/served without edit/send rights, denied business edits, branch/station denial, FIFO source precedence/oversold exclusions/warehouse boundaries, duplicate-line re-save, and exact original-definition rollback parity. Canonical/deployed update_order comment/layout differences are exact-body pinned and token-equivalence tested.

Frontend subset #511 released separately at `b640022353f840a9ebda68365aa3f28b25cae13b`; post-merge Full Verify 38785028564 and Pages 38785028521 SUCCESS. Thermal material section, preserved automatic identity and audit failure handling verified in public deployed assets. No forced live close/print/order was used.

After owner reapproval at21:29 Cairo, production migration `20261015183017_operations_stability_all_branches` applied successfully via the same Supabase migration tool. Installed hashes: permission trigger `03e28d99fcec1b031e69a14fee5eb9c7`, FIFO reader `fdde2b31a97ec9b8398ac03b7b07a3b0`, update_order `97cb1b42057f0faf373f561ea4fd97fc`. All match exact tested SQL. Other functions, policies, trigger definitions, constraints, table ACL/RLS and changed-function ACL/owner/security/search_path fingerprints unchanged. Live post-apply sample prices remain exactly0,5.250000,12.430000. Natural operational traffic, not artificial order/print replays, is the next observation boundary.

Bounded live read-only old/candidate comparisons: three material/branch/warehouse contexts returned exactly 0, 5.250000 and 12.430000 for both. Three alternating EXPLAIN samples per reader/context: Smouha priced read median 8.769→4.875ms, buffer hits 1969→886; Cleopatra 1.492→1.141ms, hits 380→180. Unpriced fallback scans all sources as before (2165→2159 hits), timings noisy ~9ms. No peak-load or overall FIFO timeout cure is claimed.

## Production gate
Initial production request was declined without a reason. No alternate path was used. After explicit owner approval to re-request at21:29 Cairo, the same exact tested migration succeeded. Source is now being reconciled with released main/#511; functional SQL/tests remain unchanged, with fresh exact-head checks before merge.

No Merge ولا Production migration before exact-head Full Verify, observed parity/performance and safe rollback. User has authorized fixing all verified problems; do not request redundant routine permission. A passing unit suite is not evidence of deployed stability. Claim/start/complete signatures and fingerprints must remain untouched.

## Next action
Complete source reconciliation and fresh CI, merge the unchanged functional database repair, and inspect post-apply reads/real operational results. Roll back immediately on proven regression using the captured original definitions after checking the installed hashes. Establish installed-agent evidence before any Windows-specific remediation; pickup latency is not declared fixed.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل؛ CI يجب أن يفشل إذا اختلف الفرع أو نقص التوثيق؛ لا Merge ولا Production migration قبل التحقق. Record every change/check and reconcile HEAD before sequential publication.

## Emergency response — 22:23 Cairo
Owner explicitly requested immediate repair or emergency rollback. New 57014 failures began22:03 across kitchen send/status, settlement, dashboard and ordinary reads; no blocking PIDs found in two snapshots. Traces include unchanged raw FIFO SUM, approved ingredient price snapshot and permission reads; causality to #510 is unproven. At22:24:58 migration20261015192458 restored exactly the captured original update_order and _raw_last_known_fifo_cost definitions as a bounded emergency precaution. Guard pins installed candidate hashes and uses3s lock timeout. Verified original hashes4f98bda4ad3d8bb4b060abb792d4f3f5 and6e70ec55b033454f4084266b13651cf7. Narrow KDS permission repair retained; V7 claim hash230529255ab7fe21df1eb1ca0f07f1b6 unchanged. No order, stock, accounting or print job replay; thermal report repair retained. Post-rollback incident observation ongoing; do not declare recovery from migration success alone.
