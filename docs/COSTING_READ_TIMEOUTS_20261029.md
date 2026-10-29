# Costing read timeouts
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/costing-read-timeouts-20261029`
Current PR: #548
Last updated: 2026-10-29

## Work status
State: **BLOCKED**
Preparation in progress; production untouched by this candidate.

## Guardrails
One writer. No operational orders/prints, stock writes or replay in production. No role, ACL, SECURITY DEFINER, price precedence, costing formula, RLS or installed printer changes. Online-primary remains authoritative. No polling/retry or paid capacity change. Do not treat cumulative statistics as incident-window consumption.

## Baseline
Main8e82a059e1270353f3a4d2550942c1d03557b202, tree6815f243f9c9be60ee4683aec844b891b17e6382. #547 released receiving-price/ratio changes remain intact. Local mirror has identical baseline tree.

## Root-cause ledger
Bounded user telemetry confirms Costing Center timeouts and POS SQLSTATE57014 across both branches, including versions before #547. Two activity snapshots had no blocking PID; broader capacity cause remains unproven. Cumulative pg_stat_statements shows costing summaries/prices repeatedly reading many cached blocks. Summary/estimate predicates convert every sale timestamp to Cairo date, preventing direct timestamp index bounds. The screen hides completed product costs until two further summary requests finish. Shared report cache omits two current read RPC names, treating them as writes; diagnostic record_user_issue also clears report reuse.

## Change ledger
Two invoker function bodies use existing sales timestamp indexes for finite UI ranges, converting Cairo bounds once. Existing predicates remain fallback for null/unbounded/infinite/extreme dates. No index/schema addition or operational write. Exact guarded inverse restores bodies. Keep all original visibility, source precedence, totals and price logic. Completed product-cost rows appear independently; financial summary appears only after all required reads succeed. Errors retain actual safe cause/context. Add two current read RPCs to bounded60s cache; diagnostic-only issue recording no longer clears it. Operational writes still invalidate before and after completion. No new RPC calls.

## Verification ledger
23 focused cache/component tests passed. Isolated DB parity/recovery test added for complete summary/estimate output, Cairo DST boundaries, nullable and one-sided dates, infinite/extreme dates, exact restored/reapplied metadata and index eligibility. Existing foreign-branch/anonymous denial and cost source precedence tests retained. DB tests must run only isolated CI, never production. 27 focused UI/cache/worklog tests, app/test typechecks, production build, changed-source lint, locked DB identity and API contract passed. Final exact-head four-job Verify pending. No performance gain or global timeout cure claimed before observation.

First exact-head CI40945280417:1162 existing DB/RLS tests passed; the added parity test failed because its harness incorrectly called row_to_json on an already-JSON scalar. Correct the test to compare the original JSON directly; SQL/application unchanged. New exact-head verification required.

Second exact-head CI40946028599:1162 existing DB checks passed again; new full-result parity across56 boundary/fallback cases and exact rollback/reapply metadata passed. The final EXPLAIN harness failed because a non-word-boundary parameter replacement also modified history_clamp_from. Restrict replacement to complete parameter identifiers and permit valid bitmap recheck timestamp conditions. SQL/application remain unchanged. Final exact-head CI pending.

## Production gate
لا Merge ولا Production migration before separate owner release approval and exact-head four-job success. Recheck live original bodies/security before atomic guarded migration (lock2s/statement15s). Rollback scripts restore two original bodies; frontend revert restores rendering/cache behavior. No production integration tests.

## Next action
Complete focused checks, publish one reviewed candidate and run exact-head CI; report evidence and remaining global-capacity uncertainty before requesting release approval.

## Mandatory update protocol
السجل هو المرجع الإجباري للعمل. CI يجب أن يفشل when branch/worklog identity diverges. Keep exact-head checks and PR ledger current; no duplicated healthy CI. Skipped tests never count as passed.
