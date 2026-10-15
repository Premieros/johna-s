# Closing report materials and scoped shift audit
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/closing-report-materials-20261015`
Current PR: #511
Last updated: 2026-10-15 Cairo

## Work status
State: **BLOCKED** until exact-head Full Verify passes; owner authorized fixing all verified operational failures. Sequential single writer. Unexpected HEAD: stop and reconcile.

## Guardrails
Frontend only, both branches. Preserve all money, stock, FIFO, order/print idempotency and branch isolation. No production SQL apply, Windows replacement, live operational fixtures or old job replay. Do not bypass the Supabase migration decline from #510. Other unscoped legacy audit callers outside shifts are not claimed repaired.

## Baseline
Main `6e4792e38c6a62aa4446a1976fb93b8b23ebc973` includes #508 costing read repair and #509 identity export; both preserved. #510 source `4326b17c91864af088544ff9466035c69bb74c38` has Full Verify 38782209302 green (1795 frontend,1071 DB,132 Chromium), Fast Verify 38782196520 green. Its production migration returned “Migration was declined.” without a stated reason. Read-only postcheck confirms all original functions unchanged: permission trigger 4005b798987336d6001d7e01e5eb14c3, FIFO reader 6e70ec55b033454f4084266b13651cf7, update_order 4f98bda4ad3d8bb4b060abb792d4f3f5. No rejected SQL is included in this PR.

## Root-cause ledger
- Authoritative closing data already contains raw materials and actual/estimated consumption costs; automatic thermal TEXT omitted the section while HTML/A4 included it.
- Client shift audit lacked operation branch, causing RLS rejection, and awaited remote identity/audit I/O before report enqueue.
- KDS repeated status errors, temporary order-matching DDL and eager FIFO fallback remain staged in #510, not deployed. Print pickup latency in Smouha remains unresolved; DB wake trigger/publication/RLS and replication are healthy. No installed Windows version is proven from server metadata.

## Change ledger
- Print every material name, quantity/unit, actual/estimated costs and total displayed cost from the existing authoritative summary; keep all cash amounts untouched.
- Retain automatic report identity `zreport:auto:${shiftId}`; no historical print replay.
- Pass exact operation branch for shift open/close; daily close retains its existing details.branch_id. Use local session identity with existing RLS and sanitized insert failure reporting.
- Enqueue the durable automatic report before optional client audit network I/O.

## Verification ledger
Functional tests verify Arabic/English material output, decimal quantities, unlike units, separate actual/estimated prices, totals, unchanged drawer data, branch attribution, error handling and enqueue-before-audit order. These sources passed the #510 full suite; fresh exact-head checks required for the extracted frontend-only head. No live sale or print test is performed.

## Production gate
Follow-up 2026-10-15 21:29 Cairo: owner explicitly approved re-requesting #510. Same Supabase tool applied the exact tested SQL successfully as migration20261015183017. Original decline was respected until reapproval. Active follow-up is `docs/OPERATIONS_STABILITY_ALL_20261015.md`; earlier blocked statements below describe the initial frontend-only release boundary.

No Merge ولا Production migration before verification. This release includes no migration; exact-head Full Verify gates frontend publication. The previously declined database action remains blocked and must not be rerouted through execute_sql or another credential/path.

## Next action
Run exact-head Full Verify, merge/deploy independent frontend changes, verify deployed asset contents and observe new logs/jobs. Record release results in PR metadata without modifying a verified head. Database repair and installed-agent diagnostics remain separate outstanding work.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل؛ CI يجب أن يفشل إذا اختلف الفرع أو نقص التوثيق؛ لا Merge ولا Production migration قبل التحقق. Reconcile HEAD before each sequential publication and record verified results and unresolved blockers accurately.
