# POS realtime backpressure — 2026-11-12

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/pos-read-initplans-20261112`
Current PR: #633
Last updated: 2026-11-12 18:41 UTC
State: **BLOCKED**

## Work status
Emergency restoration was requested without questions, followed by finding and stopping the source of pressure. Database reboot and migration 20261112183157 were applied and verified in the preceding incident response. This candidate fixes a reproducible event-driven full-snapshot loop; it does not establish that this loop alone initiated the memory/swap incident.

## Guardrails
Preserve canonical sales, payments, order mutations, branch isolation, permissions, accounting and installed printing/KDS. No operational test writes or paid upgrades. No interval polling added. Existing database policy migration contains only equivalent invariant SELECT checks.

## Baseline
Main dbe0373b6f20ee1c2aba3f9a6393f3059e10fd5b. Since reboot, top repeated application read was full orders/items/kitchen sends: 54 calls, 12,108 ms total, mean224 ms in the first several minutes. Send-to-kitchen mean1,382 ms; no temp writes in the observed top statements. Historical incident evidence is in docs/INCIDENT_20261112_DATABASE_RESOURCE_PRESSURE.md.

## Root-cause ledger
- Confirmed immediate incident symptom: swap use ~771 MB on ~432 MB RAM and IOwait81.34%; not disk-capacity exhaustion.
- Confirmed software contributor: usePosRealtime immediately repeats a complete snapshot when an event arrived during its read. Continuous events can sustain a full-snapshot loop and hold the load-cycle promise/initial loading open until quiet.
- Individual backend memory diagnostics were denied by provider permissions. No privilege escalation attempted. The exact process/workload that initiated memory pressure remains unresolved.
- Latest manual print recovery adds user-invoked dialog reads; no evidence obtained that it initiated this incident.

## Change ledger
- Full snapshots driven by same-branch notifications start no more frequently than every2 seconds and never overlap.
- Keep one trailing refresh and publish the first completed snapshot without waiting for a quiet branch.
- Branch changes finish the new branch snapshot before resolving its load cycle; the prior branch data stays cleared.
- Clear delayed refreshes on unmount; no writes, printing or KDS queue processing are queued by this scheduler.
- Previous two SELECT-policy InitPlan changes retained and documented; restrictive financial policies unchanged.

## Verification ledger
- New behavior tests: sustained20 notifications, slow initial read with trailing event, branch change during in-flight read and unmount cleanup.
- Focused23 tests /5 files pass.
- Full local frontend:2,102 tests /421 files pass.
- Application/test TypeScript, changed-file ESLint, production build and diff whitespace pass.
- Local npm11 clean install rejected pre-existing optional lock entries; npm10 clean install succeeded without a lockfile change (CI uses Node22/npm10).
- Exact-head GitHub frontend, DB/RLS, retained asset continuity and browser checks remain required.

## Production gate
State BLOCKED until exact-head CI succeeds. User emergency repair authorization covers verified merge/publication; never bypass existing checks. Backend emergency migration is already applied; the frontend scheduler is not yet published.

## Next action
Push reviewed candidate, require exact-head CI, merge only on success, wait for verified main and actual Pages deployment, then verify published source and live POS reads.

## Mandatory update protocol
Update this log and the first active work entry after new findings, verification failures or release transitions. Do not claim that a load contributor is the sole initiating cause or claim deployment from local tests alone.
