# Manual delayed print recovery
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/manual-delayed-print-20261112a`
Current PR: `632`
Last updated: 2026-11-12
State: **READY**

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
Five isolated DB integration checks passed (permission/branch denial, strict eligibility, canonical agent exclusion, explicit confirmation, uncertain-output terminal guard); protected RPC fingerprints are unchanged.37 focused UI/permission/output tests passed. Both application/test typechecks, targeted lint and production build passed. No live print operation or role grant. Production untouched.

## Production gate
Candidate must pass exact-head checks before deployment. No auto-grant to role names.

## Next action
Open review PR and require exact-head verification before production application.

## Mandatory update protocol
Record test results and exact head. Never claim physical output from browser dialog alone.
