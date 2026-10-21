# Production audit repairs — 2026-10-21

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/production-audit-20261021`
Current PR: `0`
Last updated: 2026-10-21

## Work status
State: **BLOCKED**
Owner authorized repairing the five production audit findings. Prepare an isolated, tested candidate; no production migration, merge, or deployment in this development step.

## Guardrails
One writer; production reads only and bounded. No production sale, send, settlement, print claim/replay, permission grant or data repair. Preserve installed Windows print agents and their configuration, RLS, accounting, warehouse boundaries and idempotency. The local Windows pilot remains separate and MUST NOT merge.

## Baseline
Production/main: `9114865abdd198ee609f946715a1a83b17f1e206` (#527). Separate local pilot branch: `experiment/local-windows-20261020`; excluded from this change.

## Root-cause ledger
- MonthCloseReview still uses inventory-movement consumption while the detailed page uses sold recipes; confirmed against exact production source and function hashes.
- PostgreSQL logs show timeouts during repeated KDS order mutations/served baseline and raw FIFO price lookups; report timeouts also include journal-line aggregation. Reproduce and narrow before changing SQL.
- One Smoha kitchen job waited 33m31s before its first claim, then submitted in 0.82s. No retained first-party installed-agent heartbeat proves whether the PC/agent was available; do not claim a server-only fix resolves a stopped or sleeping Windows machine.
- A Smoha settlement was rejected twice for warehouse mismatch and succeeded later. Preserve the server rejection, investigate the preview/binding race; never silently switch warehouses or auto-retry payment.
- Telemetry currently omits the app version and some preview errors lose structured diagnostic codes.

## Change ledger
Implementation in progress. No production changes.

## Verification ledger
Baseline identity and production source verified read-only. Focused tests pending; exact-head release gates remain required.

## Production gate
State: **BLOCKED**
No Merge ولا Production migration without complete candidate verification and separate explicit release approval. Success of development checks is not deployment authorization.

## Next action
Unify consumption summary; preserve structured diagnostics and build identity; reproduce operational query/locking failures; prepare tested targeted SQL and print recovery candidate without modifying installed agents.

## Mandatory update protocol
Before writes, reconcile branch/main. Stop on unexpected head divergence. Update this ledger for material changes, evidence, checks and blockers. Keep unfinished causes explicit; never report the production system fixed while the candidate is only staged.
