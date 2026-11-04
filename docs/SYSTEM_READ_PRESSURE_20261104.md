# System read-pressure reduction — 2026-11-04
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/system-read-pressure-20261104`
Current PR: `604`
Last updated: 2026-11-04
State: **BLOCKED**

## Work status
Prepare and verify system-wide transport and dashboard overload fixes on deployed main3cf36b4. The raw last-price cutover is complete and preserved. No production schema change or operational test writes.

## Guardrails
Preserve branch/permission/RLS isolation, last-price including zero, stock quantities, accounting, kitchen sends and installed printer behavior. No new polling, persistent cache, upgrade or production synthetic transactions. Unknown RPCs and all writes must remain independent and unqueued.

## Baseline
Production initial read showed no lock wait at the observation instant. Cumulative statistics rank realtime, full order snapshots, kitchen dispatch, dashboard snapshots and legacy availability highly; these are not current-period measurements. A correctly keyed36-second delta (userid/queryid/toplevel) observed6 full POS reads617ms,6 table reads185ms,73 realtime polls984ms, one real kitchen send1629ms and one sale676ms. This sample is too small to claim system-wide CPU or P95 improvement. No production load generation.

## Root-cause ledger
- Dashboard catches every aggregate failure as null and launches raw current/previous sales, product details and payment fallback reads, amplifying a timeout.
- Global concurrent GET deduplication is coupled to the first caller's abort signal. A leaving screen can cancel other consumers. RPC reads do not share concurrent work. Mutation completion does not invalidate reads started during the write.
- POS live snapshots ignore table/order errors, can falsely publish an empty floor plan and still issue an operator-label read.

## Change ledger
- Share only identical in-flight GETs and three explicitly reviewed stable display RPCs: dashboard sales snapshot, open-order print state, POS operator labels. Full headers/identity/body/URL are part of the key; no completed-response reuse or report queueing.
- Each consumer can cancel independently. Only the last consumer leaving cancels transport; remove abandoned entries immediately. Invalidate generations at both write start and completion. Writes remain independent.
- Raw dashboard fallback is compatible only with absent-RPC codesPGRST202/42883. Database timeout, network, capacity, permission and malformed-response errors stop at the failed read and permit explicit retry.
- Reviewed display RPC reads no longer evict unrelated valid report reuse; financial/operational writes still invalidate reports at start and completion.
- Failed POS table/order reads reject before labels, allowing the existing hook to preserve the last good snapshot.

## Verification ledger
Focused verification:69 tests across10 files passed in2.87s, including20 identical RPCs reduced to1 network read (95% fewer in that controlled burst), independent cancellation, post-commit freshness, permission/parameter separation, unchanged independent writes, dashboard timeout/retry and POS failed-snapshot handling. Application/test typecheck, lint (0 errors;10 existing warnings) and production build passed. Mandatory exact-head Full Verify remains pending. Production three display RPCs confirmed STABLE; no function changes. Advisors read, with existing notices retained; no speculative index creation. Local20-reader burst will measure network-call reduction, not whole-system speed.

## Production gate
Required exact-head Full Verify and permitted merge/publication. No SQL migration to apply. Do not claim deployed until Pages succeeds on merged head.

## Next action
PR #604 is open. Local focused checks and full diff review passed; complete required exact-head verification before merge/publication. Rollback is a revert of this frontend commit; no database rollback or historical recomputation.

## Mandatory update protocol
Update this log with real checks, PR, merge and Pages results. Never equate cumulative stats with live usage or a mocked read reduction with production speed.
