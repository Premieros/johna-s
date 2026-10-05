# PAGES ARTIFACT SELECTION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/pages-unfiltered-history-20261005`
Current PR: `#457`
Last updated: 2026-10-05

## Work status
State: **BLOCKED**
User approved completing blocked deployment at 17:59 Cairo. Exact-head Full Verify required.

## Guardrails
Single writer, no direct main writes, no force pushes. No database, application, POS,
KDS, stock or printing changes. Preserve active-session asset protection.

## Baseline
Main db46b301d69599010c9da97e967240c363997b37; #454 merged with all tests green.
Deployment 37328422301 failed twice before publishing at previous-artifact discovery.
Last successful deployment 37323787272 has an unexpired github-pages artifact 11350529688.

## Root-cause ledger
Conclusion-filtered run listings returned older runs while unfiltered main listings
returned the actual latest successful deployment. Missing old artifacts caused a safe stop.
The underlying GitHub index inconsistency is inferred from these differing responses.
CI also selected an old run from the workflow-specific index; repository-wide history
returns the current deployments. Select workflow path and branch locally as well.

Post-deploy verification selected an old run even from repository history when branch
was an API filter. Unfiltered repository listings returned the actual current runs.
Remove server branch filtering as well; retain explicit client path/branch/status checks.
#455 deployed successfully (37332715772); #456 phone UI awaits this publication guard fix.

## Change ledger
Read repository-wide latest workflow history and filter deploy.yml/main locally. Locally require completed success,
exclude current run, and paginate up to 1000 runs. Log the chosen run ID. Exhausted first
deployment may proceed; search-limit exhaustion fails closed. Missing/expired latest-success
artifact still stops deployment; never fall back to an older success. Retention unchanged.

## Verification ledger
Execute the actual composite-action script with simulated histories: latest success,
current/failed/in-progress exclusions, pagination, missing/expired artifacts, first deployment
and bounded-search exhaustion. Existing immutable-asset retention tests remain required.

## Production gate
State: **BLOCKED**
Exact-head Full Verify and current main reconciliation required before approved merge/deploy.

## Next action
Pass CI, merge expected head, verify asset retention, production parity and Pages deployment.
Then implement separately authorized mobile-only POS layout/category navigation.

## Mandatory update protocol
STOP_AND_RECONCILE on unexpected main movement. Bind actual PR and CI evidence before merge.
