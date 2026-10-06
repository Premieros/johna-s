# METADATA PARITY — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/metadata-parity-20261006`
Current PR: `#462`
Last updated: 2026-10-06

## Work status
State: **BLOCKED**
Preparation authorized; one additive Production API and publishing remain gated.

## Guardrails
Single writer, selected project only. No changes to RLS, Financial Visibility,
branch/station/history guards, printing, send_to_kitchen, POS, stock/FIFO,
accounting, settlement or shifts. No SECURITY DEFINER or operational live tests.
Usage Watch and other automations remain disabled. No historical rewrite.

## Baseline
Main a6a54802f77b773e4822ffbb430dabf18087bf68 (#461 deployed and verified).
Unexpected head movement => STOP_AND_RECONCILE.

## Root-cause ledger
Screenshot log-query 402.3 GB is cumulative scanned log volume, not DB CPU.
The 11:11:30–11:12:30 UTC deployment parity window contained 213 PG errors:
210 permission denials and three absent id columns; checker made 216 requests
(161 operational RPCs, 54 table reads and kitchen schema sentinel).
This evidence does not attribute all monthly ingestion/scans to deployments.
45-second idle sample: 89 realtime.list_changes calls / 474.82 ms combined
execution, no sampled POS/availability/print increases; no lock backlog.
Historical PG statistics since Sep 1 do not prove current overload.

## Change ledger
Replace operational probes with bounded public-catalog checks through one new
STABLE SECURITY INVOKER API, _production_api_contract_v1(jsonb). It checks
public relation kinds and named input signatures/defaults, rejects ambiguity,
malformed/duplicate/oversized input, returns requested name/presence only.
No dynamic SQL, operational invocation or business row access. PUBLIC execute
revoked; anon/authenticated/service_role get only this data-free API's execute.
Keep the existing kitchen sentinel definition/ACL and check it separately.
Fail closed on non-200, malformed/incomplete metadata, missing/ambiguous objects,
or false sentinel; no broad operational-probe fallback. Two successful requests
replace 216 (99.07% fewer parity requests, not a monthly usage/CPU prediction).
Migration reloads PostgREST schema cache. Metadata verifies live definitions,
not each operational route's cache entry or runtime permissions. The sentinel
routes verify API availability; cache reload must complete before publishing.
No blanket logging suppression: real operational errors remain visible.

## Verification ledger
Behavior tests cover exact call count, no operational fallback and HTTP/JSON/
contract/sentinel failures. Isolated DB tests cover current full contract, anon
invoker access, missing/wrong signatures, defaults/OUT arguments, ambiguity,
invalid bounded inputs and never-executed throwing fixture functions.
Required exact-head Full Verify includes unit/type/lint/build, all DB/security
regressions, browser flows and Pages continuity. CI evidence recorded in PR.

## Production gate
State: **BLOCKED**
No Production apply, merge or publish until exact-head Full Verify green and
separate explicit approval of this additive invoker API/migration and deployment.
Before/after capture RLS and protected operational function/ACL fingerprints.
After apply verify anon metadata+sentinel, reload visibility and fail closed on
mismatch. Roll back checker before removing API; never restore noisy fallback
without review. No deployment-specific metrics claim before real gate runs.

## Next action
Complete isolated verification and reviewable draft PR; request exact migration
and merge/deploy approval with verified head and practical impact/limitations.

## Mandatory update protocol
Check main/head before writes. Unexpected movement => STOP_AND_RECONCILE.
Record exact-head final CI in PR metadata without changing the tested head.
