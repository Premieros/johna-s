# WEB CLOUD PRINT REALTIME WAKE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/web-cloud-print-realtime-wake-20261002-r2`
Current PR: `#0`
Baseline: `main@04ed847f726049f87055eafba079ce51e7cb2db4`
Last updated: 2026-10-02

## Work status
State: **BLOCKED**

## Baseline
- Repository baseline: `main@04ed847f726049f87055eafba079ce51e7cb2db4`.
- Active branch: `hotfix/web-cloud-print-realtime-wake-20261002-r2`.
- Reconciliation branch is rebased by reconstruction from latest main; replacement PR not opened yet.
- No Production migration is part of this track.
- Installed Smouha/Cleopatra Print Agent executables and local configuration are frozen.

## Objective
Reduce historical Cloud Print polling/log load from the browser without requiring any Print Agent reinstall and without changing installed V8 executables, queue RPCs, printer routing, payloads, kitchen sending, or durable print state.

## Production evidence
- Database size is small relative to log usage; current concern is Log Ingestion / Log Query, not table size.
- Historical `claim_cloud_print_jobs` calls exceed 1.13M.
- Browser `CloudPrintAgent.tsx` currently uses a 700ms claim loop when the legacy web agent is enabled.
- Live measurement on 2026-10-02 showed zero new claim calls across a 10s idle window, so the severe claim rate is not currently active.
- Dedicated print accounts are actively claiming submitted jobs:
  - Cleopatra: `print@premier.sa`
  - Smouha: `printer-s@premier.sa`
- Existing `cloud_print_wake_state` Realtime wake is present for both branches and is already used by installed V8 agents.
- Current V8 executable behavior uses Realtime wake, 60-900s connected reconciliation, and 5-60s disconnected fallback.

## Root-cause ledger
1. Historical browser Cloud Print fallback used a fixed 700ms durable-queue claim loop.
2. Historical `claim_cloud_print_jobs` execution count exceeded 1.13M, consistent with high-frequency idle polling over time.
3. Current dedicated V8 agents are healthy and already use `cloud_print_wake_state` Realtime wake with slow fallback.
4. Live idle measurement showed the historical claim storm is not active now, but the 700ms browser path still exists and could reactivate if legacy browser Cloud Print is enabled.
5. Reinstalling restaurant Print Agents is operationally unacceptable; containment must therefore be Web-only and backwards-compatible.

## Guardrails
- No changes to `print-agent-v8/**`, `print-agent-lite/**`, frozen V7/V8 binaries, package hashes, or installed-device configuration.
- No changes to `claim_cloud_print_jobs`, `start_cloud_print_job`, `complete_cloud_print_job`, queue status transitions, printer routes, receipt/kitchen payloads, or `send_to_kitchen`.
- No Production migration or data rewrite.
- The browser fallback must remain capable of printing if a dedicated agent is unavailable.
- Realtime wake must provide immediate claim scheduling.
- Connected reconciliation interval: 60s.
- Disconnected fallback interval: 5s.
- Local print transport must still be verified before claiming a durable job.
- Single writer, no force push, no direct `main` writes.
- Unexpected branch HEAD or main divergence => **STOP_AND_RECONCILE**.
- Merge/deploy only after exact-head Full Verify Green and the already-approved web-only scope remains unchanged.

## Change plan
1. Replace the browser 700ms loop with branch-filtered `cloud_print_wake_state` Realtime wake.
2. Keep one immediate initial claim to drain already-pending work.
3. When Realtime is confirmed subscribed, use 60s reconciliation only.
4. If Realtime is not subscribed / errors / times out / closes, use 5s polling fallback.
5. Coalesce wake events while a claim/print cycle is already running.
6. Keep all existing claim/start/complete and local printer execution code unchanged.
7. Add contract tests that prohibit 700ms polling and require Realtime + 60s/5s fallbacks.
8. Verify active dedicated agents read-only before merge and after deploy.

## Change ledger
- `CloudPrintAgent.tsx` now subscribes to branch-filtered `cloud_print_wake_state`.
- Existing initial durable queue drain is preserved.
- Connected reconciliation interval is 60s.
- Realtime-disconnected / transport-unavailable / claim-error fallback is 5s.
- Real claimed work drains immediately until the queue is empty.
- Existing `claim/start/complete` RPC calls, local printer routing and execution paths remain unchanged.
- No Print Agent executable, installer, migration, queue schema, printer route, payload contract or `send_to_kitchen` code was modified.
- Added `cloudPrintRealtimeWakeContract.test.ts` to prevent regression to 700ms idle polling.

## Verification ledger
- Main baseline reconciled: complete.
- Dedicated print accounts / current submitted jobs: verified read-only.
- Existing wake table / RLS / both-branch trigger: verified.
- Implementation: complete on branch.
- Unit contract tests: added; CI pending.
- Fast Verify: pending.
- Full Verify / Browser Smoke: pending.
- Merge/deploy: pending.
- Post-deploy claim-rate measurement: pending.

## Production gate
State: **BLOCKED**
- No Production DB write/migration is required.
- PR #430 must remain unmerged until exact-head Fast Verify + Full Verify + DB/security/RLS + Browser Smoke are Green.
- Before merge/deploy, re-check that dedicated Smouha and Cleopatra print accounts are still actively claiming/submitting jobs.
- After deploy, verify the same dedicated agents remain healthy and measure idle `claim_cloud_print_jobs` rate read-only.
- Rollback is web deployment rollback only; installed Print Agents are not changed and require no reinstall.

## Definition of done
- No `700ms` browser claim loop remains.
- Browser wake reacts to `cloud_print_wake_state` Realtime events.
- Browser fallback polls no faster than 5s when Realtime is unavailable and reconciles at 60s while connected.
- Existing printer transport gate is preserved before any claim.
- Existing queue RPC names and print execution behavior are unchanged.
- Installed print agents require no reinstall or configuration change.
- Exact-head Full Verify is Green.
- Post-deploy dedicated-agent claims continue and idle `claim_cloud_print_jobs` rate stays near zero when the web fallback is not needed.

## Next action
Open the replacement Draft PR, run exact-head Fast Verify + Full Verify, reconcile any failures on this branch only, then re-check live dedicated-agent health before merge/deploy.

## Mandatory update protocol
- Before every repository write, verify latest `main` and expected branch HEAD.
- Unexpected HEAD or main divergence => **STOP_AND_RECONCILE**.
- Single writer on this branch; never force push and never write directly to `main`.
- Update this log after material implementation, verification, merge or deployment events.
- Keep State **BLOCKED** until exact-head Full Verify is Green and all operational print-health checks are complete.
- Do not modify or redistribute installed Print Agent binaries/configuration in this track.
