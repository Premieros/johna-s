# Manual delayed print recovery
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/manual-delayed-print-20261112a`
Current PR: `632`
Last updated: 2026-11-12
State: **DEPLOYED**

## Work status
Owner requests a manager-operated browser fallback for delayed printing.

## Guardrails
No installed-agent changes, frozen queue RPC changes, role grants, automatic reprints or live test orders. Existing print-kind authority remains required in addition to the dedicated manual recovery permission. Only never-claimed pending jobs at least15 seconds old are eligible.

## Baseline
Main d7c7acc; durable queue and existing start/complete receipt authorization remain canonical.

## Root-cause ledger
This is a manual operational alternative, not a claim to fix the intermittent Smouha notification delay. Browser print dialog cannot prove paper output or distinguish cancellation; operator confirmation is explicit.

## Change ledger
Add bounded on-demand delayed-job list, atomic target reservation and manager confirmation endpoints. Native start/complete run without definition changes. Manual lease is10 minutes; uncertain outcome uses existing terminal PRINT_OUTCOME_UNKNOWN protection. No background queue polling.

## Verification ledger
Five isolated DB integration checks passed (permission/branch denial, strict eligibility, canonical agent exclusion, explicit confirmation, uncertain-output terminal guard); protected RPC fingerprints are unchanged.37 focused UI/permission/output tests passed. Both application/test typechecks, targeted lint and production build passed. No live print operation or role grant. Production migration20261112163357 applied with before/after exact fingerprints of all4 frozen functions; no role grants or live print output.

## Production gate
Completed: PR632 exact-head Verify main43259080303 passed. Merge c101d8cb reached main, but GitHub delayed finalizing the merge/event. A no-source-change fast-forward00b3bfad restored the push event without bypassing any gates. Main Verify43261368016 and actual Pages43262347872 passed at00b3bfad. Earlier manual dispatch43260857809 was cancelled automatically by concurrency; it was not used as a deployment bypass. No role grants.

Read-only live validation: an ungranted operator is denied; admin delayed lists succeed for both branches. Native browser verified POS→More→manual printing opens on Smouha with no errors and an empty eligible list. No real ticket reserved or printed.4 actual local concurrent manager/native claim races each produced exactly one owner.

Rollback: restore the previous frontend only after any manual dialogs are resolved; keep the additive endpoints until active reservations finish. No frozen agent-function rollback or historical ticket replay. Unconfirmed expired reservations retain the canonical terminal unknown-outcome guard.

## Next action
Released. Grant pos.print_recovery explicitly to intended operators through role permissions, together with the ticket-kind print permission; no grant is inferred from a role name.

## Mandatory update protocol
Record test results and exact head. Never claim physical output from browser dialog alone.
