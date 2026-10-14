# Emergency cloud print wake recovery — 2026-10-14
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/print-wake-emergency-20261014`
Current PR: #504
Last updated: 2026-10-14 21:45 Cairo

## Work status
State: **BLOCKED** pending exact-head CI and owner-approved release. Emergency frontend-only mitigation for missed Realtime wake in the enabled browser cloud-print agent. This does not claim that real paper is printed or that kitchen RPC timeouts are resolved.

## Guardrails
Do not modify Windows agent or installed printer; no production SQL, schema/functions/index activation, stock, FIFO, sales, financial, branch routing, queue job replay, test orders or synthetic prints. Preserve claim/start/ack, idempotency, station serialization, visibility and authorization. Do not auto-reprint previously submitted/ambiguous jobs.

## Baseline
main@8fffc3d3f313e620e468112ff2c8921cc33cfb98; #502 KDS visibility fix and #503 CI scheduling fix already merged. In read-only production evidence, Smoha kitchen queue creation-to-submission p95=11.7s, while local execution after claim generally remains below 1.2s at p95 for kitchen; many slow samples spent ~11s awaiting claim. Cleopatra kitchen p95=3.3s. No Windows change is justified by these findings.

## Root-cause ledger
The frontend cloud agent responds to Realtime wake; when connected, its idle reconciliation is 60s, so missed wake can cause long durable-job waits. This is a bounded fallback mitigation, not proof that Realtime is the single root cause or that the browser agent is the only claimant.
A separate 24h read-only audit recorded 46 PostgreSQL statement timeouts (6 send_to_kitchen, 7 open order print checks, 9 queue-related reads, others). A timed-out send before dispatch never creates a print job; this needs separate database performance work and cannot be safely fixed by more polling.
Two Cleopatra orders (Johna's-03349 and Johna's-03351) had kitchen send rows with no matching cloud kitchen print job, but a local fallback cannot be ruled out. Do not auto-replay them.

## Change ledger
Change only `REALTIME_RECONCILE_INTERVAL_MS` in `src/features/pos/components/settings/CloudPrintAgent.tsx` from 60,000ms to 8,000ms when connected and idle. Keep disconnected interval 5,000ms, serial claim, idle job draining, native Windows agent and all station routes unchanged.
Cost: a connected and idle enabled browser agent may make up to approximately 7.5 times as many reconciliation requests as before; monitor backend contention. If this load increases timeouts or doesn't help live queue latency, revert this single constant rather than modifying inventory/print status records.

## Verification ledger
First PR head 63a50d4795447d1ffbfe63c0950f10bef723439d: Windows build SUCCESS; verify-main db, browser-smoke and pages-continuity SUCCESS; frontend verify FAILED only because stale mandatory active log declared development/ci-concurrent-verification-20261014. No failed functional tests. This document and active-plan pointer correct the PR worklog gate in the follow-up head. Do not re-run already passing jobs individually; normal mandatory CI remains required for new head.

## Production gate
State: **BLOCKED** until exact final PR head checks succeed and release is authorized. This does not repair 57014 send failures or guarantee paper output. No production actions or data mutations were performed for this patch.

## Next action
Complete mandatory exact-head check once. If successful, review the narrow diff and release gate before merging; inspect actual Smoha queue claim times and timeout rate after an authorized deployment. Investigate canonical send_to_kitchen latency and missing cloud enqueue separately in a safe isolated database, not by activating the blocked kitchen optimization or replaying live tickets.

## Mandatory update protocol
One writer; preserve branch safeguards, current main, source-order branch isolation and original production data. Never write directly to main or force push. Do not use broad automatic reprint to hide missed enqueue. A failed exact-head gate stops merge.
