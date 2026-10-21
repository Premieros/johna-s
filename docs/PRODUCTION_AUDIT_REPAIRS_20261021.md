# Production audit repairs — 2026-10-21

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/production-audit-20261021`
Current PR: `528`
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
- Month summary now uses the sold-recipe report with unchanged explicit/manual loading and costing permission gate.
- Build SHA is attached to safe telemetry; preview failures retain structured diagnostic sources without persisting raw payloads.
- Explicit warehouse rejection refreshes the same order preview and requires user confirmation; no automatic payment retry or warehouse override.
- Guarded SQL candidate serializes KDS order first, avoids same-status writes after authorization, preserves treasury balances via account-indexed lateral aggregation and adds two exact-predicate FIFO fallback indexes. No deployed function or policy changed.
- Windows recovery source candidate wakes on connection state changes, detects silent half-open sockets and schedules one coalesced recovery read after claimed lease expiry. Idle polling, batch size, RPCs, branch binding, physical print rendering and installed binaries/configuration remain unchanged.
- CLI v2.81.3 generated `supabase/migrations/20261021074150_production_audit_repairs.sql` in isolated CI. It is committed for canonical verification, NOT applied to production. The candidate source remains reviewable under scripts/db/candidates; guarded rollback restores the exact two original function hashes.
- Production rollout must first build the two additive indexes concurrently, each as its own top-level command using `production_audit_indexes_concurrently.sql`, verify validity, then apply the function migration. This avoids a normal index build holding production writers; the migration uses IF NOT EXISTS for the prebuilt indexes. No automatic production execution.

## Verification ledger
- Baseline identity and production source verified read-only.
- Focused frontend regression suite: 34 assertions passed, including wrong-scope settlement, explicit warehouse rejection and ambiguous-network non-retry.
- Typecheck and targeted lint passed (two pre-existing hook dependency warnings).
- Owned PGlite SQL proof passed: repeated KDS audit/served baseline once, same-status authorization/station denial, NULL validation, ACL/security-mode parity, treasury result parity and targeted index usage with 50,000 unrelated journal rows and 50,000 unpriced receipts. Synthetic timings are not production latency claims.
- Owned local frontend suite: 383 files / 1853 assertions passed; 30 focused regression assertions also passed after the last frontend edit.
- Windows compilation, confirmed-subscription/half-open-socket protocol checks and Arabic report rendering passed on staged head `2fd039e3f39bc1e3c1e981329186d11da06d9ac6` (run 39563768567), without networking or physical printing.
- Isolated SQL proof + CLI-generated migration passed on that head (run 39563768575); guarded rollback additionally passed locally.
- Fresh exact-head gates must run again after adding the generated migration. Baseline security advisors were read only; no new exposed function, grant, owner or RLS change is introduced.

## Production gate
State: **BLOCKED**
No Merge ولا Production migration without complete candidate verification and separate explicit release approval. Success of development checks is not deployment authorization.

## Next action
Run exact-head CI with the generated migration, review the guarded rollout/rollback, and retain the production release gate. Installed-agent availability/PC sleep and physical printer behavior require device verification; these are not proven fixed by staged source alone.

## Mandatory update protocol
Before writes, reconcile branch/main. Stop on unexpected head divergence. Update this ledger for material changes, evidence, checks and blockers. Keep unfinished causes explicit; never report the production system fixed while the candidate is only staged.
