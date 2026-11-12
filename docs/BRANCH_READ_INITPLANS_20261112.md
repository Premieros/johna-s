# Branch read InitPlans
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `perf/branch-read-initplans-20261112`
Current PR: `630`
Last updated: 2026-11-12
State: **DEPLOYED**

## Work status
Execution environment restored and the blocked PR628 continuation is released in PR630. Authenticated October historical-cost read now measured3042.255ms in Smouha and4950.134ms in Cleopatra, under the unchanged8s limit. The earlier Smouha observation was6351.63ms. These are specific observations, not a universal load guarantee.

## Guardrails
No new permissions, roles, persistent/cross-user authorization cache, price/balance sources, business writes, timeout changes or print-agent/RPC edits. Use owned rollback fixtures. Public report RPCs remain invoker-secured. Preserve exact branch/history/root visibility and fail-closed policy fingerprints.

## Baseline
Main85376314f109d500e1e9136b0499658eaafa0935; tree87902f857dc33c791eb1291b23ceb108421ae4ba. PR628 applied production migration20261112095212 and Pages43196629736. Prior work log docs/ACTIONABLE_READ_ERRORS_20261112.md remains release evidence.

## Root-cause ledger
Canonical user_may_access_branch is STABLE DEFINER and begins is_pos_admin() OR own/mapped branch checks. Calling it for each movement repeats the same zero-argument platform check. The five read policies can cache that existing term as an InitPlan and retain the canonical predicate unchanged for all other callers. No new role-based rule is introduced.

## Change ledger
Candidate uses NOWAIT locks on all three tables before any DDL, so busy operational tables abort immediately without waiting while holding a subset. Guarded five read-policy substitutions on sales, kitchen inventory events and inventory ledger. Rebind both public consumption reader fingerprints atomically; no grants or function security change. Need exact rollback and actor/result parity plus a behavioral short-circuit probe.

## Verification ledger
43 focused owned DB checks passed in3.62s, including actor/history/reference parity, exact policy/RPC metadata rollback/reapply and a behavioral probe that makes the canonical per-row predicate throw while authorized direct reads still succeed. The older PR628 rollback is rehearsed beneath the newer rollback in order. Production inspection found only the two known RPC policy-fingerprint dependents; both are updated atomically. All3 existing monthly scale checks passed serially (47 focused DB checks in total). Application/test typechecks and focused lint passed. First full CI passed2091 frontend and1277 DB cases; the only failure was an old strict cache-hit comparison (1229 equals1229), even though the partial index and all amounts matched. Replace it with a stronger scan-work invariant:300 visited tuples versus at least1000, preserving amount/index/WAL checks. Added and locally verified immediate NOWAIT refusal of an active writer before any DDL. Final15 focused history/scale cases, updated test typechecks and targeted lint passed; full exact-head CI remains mandatory.

## Production gate
Owner already authorizes repair, merge and application. Apply only after full required CI and verify a bounded authenticated month read. No operational business tests.

## Next action
Release complete. Retain both fail-closed report policy fingerprints. Roll back this stage with scripts/rollback/branch_read_initplans_20261112.sql before any PR628 rollback. Do not edit either already-applied migration. Further changes require new evidence and the same actor/history/branch/print safeguards.

## Mandatory update protocol
Record tested source, actual migration and publication and observed latency; do not infer global speed from one month read.

## Application and release evidence
Exact head17dd9c4a8bdbd5dbbd29abd6bfc1dacb7fcb54c3 (tree6d9e0784504ee1380412ef0b1ff616c31aadc316) passed Verify43205986447:2091 frontend checks,1279 DB passed/1 skipped, both browser shards, smoke and continuity. PR630 merged at9fa35c99896d25adb9a4820bc8e49d6ed2d57518. Main Verify43207262651 succeeded after retrying the failed continuity job: its first failure was a GitHub API500/truncated JSON response, not an application/test failure. No runtime source was changed for that retry. Actual Pages43208126835 succeeded including production-parity and deploy. Native HTTP inspection confirmed served ./assets/index-Bs4uzMiV.js contains9fa35c99896d25adb9a4820bc8e49d6ed2d57518, preserves approval-inbox-button and lacks system-alerts-button.

Production migration20261112111021 (branch_read_initplans; source20261112104610) applied successfully with all-table NOWAIT locks. Live policy hashes match the tested rollback hashes. Both report RPCs remain SECURITY INVOKER, with the same execution ACLs and no anon access. Canonical branch function and protected print RPCs are unchanged; ordered-oid print fingerprint before/after5bf7d460c2c450eea250b8a66424eda8. Security advisor groups are unchanged. No production orders, payments, stock, pricing, role grants or print jobs were created or modified.

Bounded authenticated October2026 RPC measurements: Smouha historical cost3042.255ms /54449 shared hits /0 disk reads; Cleopatra historical cost4950.134ms /52658 shared hits /1 disk read; Smouha sales summary3283.863ms /42823 shared hits /15 disk reads. Existing authenticated/authenticator limit remains8s. No repeated polling or synthetic production fixtures were used. The owned2500-invoice raw-body diagnostic reported3030.836ms and7120098 shared hits; it is not the production RPC measurement or a system-wide capacity proof. Actual native measurements and preserved result/security checks are the release evidence.
