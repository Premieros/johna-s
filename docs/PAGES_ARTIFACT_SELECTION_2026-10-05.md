# PAGES ARTIFACT SELECTION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/pages-artifact-selection-20261005`
Current PR: `#455`
Last updated: 2026-10-05

## Work status
State: **BLOCKED**
User approved completing blocked deployment at 17:59 Cairo. Exact-head Full Verify required.

## Guardrails
Single writer, no direct main writes, no force pushes. No database, application, POS,
KDS, stock or printing changes. Preserve active-session asset protection.

## Baseline
Main 996b860a40ac3ee5cba47f53467c68b4ccaf40dd; #454 merged with all tests green.
Deployment 37328422301 failed twice before publishing at previous-artifact discovery.
Last successful deployment 37323787272 has an unexpired github-pages artifact 11350529688.

## Root-cause ledger
Conclusion-filtered run listings returned older runs while unfiltered main listings
returned the actual latest successful deployment. Missing old artifacts caused a safe stop.
The underlying GitHub index inconsistency is inferred from these differing responses.

## Change ledger
List latest deploy.yml runs without a conclusion filter. Locally require completed success,
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
