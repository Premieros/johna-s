# WEB CLOUD PRINT REALTIME WAKE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/web-cloud-print-realtime-wake-20261002`
Baseline: `main@84f4a1d78dcbe9f637f1e19d26b33de24592da73`
Last updated: 2026-10-02

## Work status
State: **BLOCKED**

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

## Verification ledger
- Main baseline reconciled: complete.
- Dedicated print accounts / current submitted jobs: verified read-only.
- Existing wake table / RLS / both-branch trigger: verified.
- Implementation: pending.
- Unit contract tests: pending.
- Fast Verify: pending.
- Full Verify / Browser Smoke: pending.
- Merge/deploy: pending.
- Post-deploy claim-rate measurement: pending.

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
Implement the web-only wake/fallback change and regression tests on this branch.
