# Branch read InitPlans
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/branch-read-initplans-20261112`
Current PR: `0`
Last updated: 2026-11-12
State: **BLOCKED**

## Work status
Execution environment restored. Continue authorized reduction of read pressure after released PR628; current authenticated October read6351.63ms under the unchanged8s limit.

## Guardrails
No new permissions, roles, authorization cache, price/balance sources, business writes, timeout changes or print-agent/RPC edits. Use owned rollback fixtures. Public report RPCs remain invoker-secured. Preserve exact branch/history/root visibility and fail-closed policy fingerprints.

## Baseline
Main85376314f109d500e1e9136b0499658eaafa0935; tree87902f857dc33c791eb1291b23ceb108421ae4ba. PR628 applied production migration20261112095212 and Pages43196629736. Prior work log docs/ACTIONABLE_READ_ERRORS_20261112.md remains release evidence.

## Root-cause ledger
Canonical user_may_access_branch is STABLE DEFINER and begins is_pos_admin() OR own/mapped branch checks. Calling it for each movement repeats the same zero-argument platform check. The five read policies can cache that existing term as an InitPlan and retain the canonical predicate unchanged for all other callers. No new role-based rule is introduced.

## Change ledger
Candidate guarded five read-policy substitutions on sales, kitchen inventory events and inventory ledger. Rebind both public consumption reader fingerprints atomically; no grants or function security change. Need exact rollback and actor/result parity plus a behavioral short-circuit probe.

## Verification ledger
43 focused owned DB checks passed in3.62s, including actor/history/reference parity, exact policy/RPC metadata rollback/reapply and a behavioral probe that makes the canonical per-row predicate throw while authorized direct reads still succeed. The older PR628 rollback is rehearsed beneath the newer rollback in order. Production inspection found only the two known RPC policy-fingerprint dependents; both are updated atomically. Monthly scale and typechecks/lint pending; full exact-head CI remains mandatory.

## Production gate
Owner already authorizes repair, merge and application. Apply only after full required CI and verify a bounded authenticated month read. No operational business tests.

## Next action
Run focused semantic/security/rollback checks, then full CI, controlled application and measured release. Never edit the already-applied PR628 migration.

## Mandatory update protocol
Record tested source, actual migration and publication and observed latency; do not infer global speed from one month read.
