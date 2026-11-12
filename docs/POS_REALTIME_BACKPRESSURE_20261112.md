# POS realtime backpressure — 2026-11-12

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/pos-read-initplans-20261112`
Current PR: #633
Last updated: 2026-11-12 19:01 UTC
State: **DEPLOYED**

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
- First exact-head CI: browser shards and asset continuity passed;1,283 DB checks passed, but historical order-type rollback rehearsal correctly rejected the newer SELECT-policy fingerprint. Add a guarded inverse for the read optimization, peel it before the historical rehearsal, reapply afterward and assert exact current policy digests. Historical drift guards remain unchanged. No production change in this correction.

## Production gate
DEPLOYED at main a9639adbd887fde01ab15e80b0829c28f7edb4f0. PR Verify43283537430, main Verify43284486022, and actual Pages43285153519 all passed. User emergency repair authorization covers this verified publication. Backend migration20261112183157 is applied. No operational test writes or paid changes.

## Next action
Release is verified. Existing open browser sessions require one normal refresh after saving any work to receive the updated frontend. The initiating process behind swap pressure remains unproven; do not claim the fixed load amplifier was the sole cause.

## Mandatory update protocol
Update this log and the first active work entry after new findings, verification failures or release transitions. Do not claim that a load contributor is the sole initiating cause or claim deployment from local tests alone.

## Release evidence
- Exact-head PR and main verification: all frontend, DB/RLS, browser shards and retained-asset checks passed. DB:1,284 passed/1 optional historical benchmark skipped. Frontend:2,102 passed.
- PR#633 merged as a9639adbd887fde01ab15e80b0829c28f7edb4f0; actual Pages43285153519 succeeded.
- Public served index-B7F66TTx.js loads format-CeZRuzay.js; both bounded snapshot scheduler markers verified in the served JavaScript.
- Fresh signed-in browser POS at the published URL loaded Smouha tables, products and17 active orders, without console errors; no order/payment/print action was invoked.
- Database check at19:00:06 UTC:0 active authenticated requests,0 older than5 seconds,0 blocked. This remains point-in-time evidence, not a guarantee against recurrence.
