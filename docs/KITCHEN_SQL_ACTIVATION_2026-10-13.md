# Johnas approved SQL activation
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/kitchen-sql-activation-20261013`
Current PR: #498
Last updated: 2026-10-13
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED** pending technical verification, NOT missing owner approval. User approved SQL activation explicitly at15:03 Cairo2026-10-13 after being told merge did not activate it. Production activation SUCCEEDED at16:22 Cairo. Actual migration version20261013132245; verbatim history archived. Remaining gate: exact-head history replay CI and merge/deploy verification.

## Guardrails
Only johnas. No table/RLS/ACL/security redesign, printing agent/queue change, real test order/print, stock-history reversal or unrelated repository. Existing canonical security modes retained. Three private helpers remain revoked invokers.

## Baseline
#497 merged19017adedb473371d76c1601159568aa8034f5ff; Pages38392110205/postmerge38392110269 GREEN:1708frontend,1037DB,132Chromium.
Canonical fingerprints match original forward tripwires. Two read snapshots had no active client transactions; snapshots alone do not enforce quiescence.

## Root-cause ledger
Approved forward package needs an enforceable quiet activation transaction. Add a NOWAIT barrier instead of assuming that no writer will start after the preflight read.

## Change ledger
scripts/rollout/kitchen_activation_barrier_20261013.sql is injected immediately after BEGIN in the SAME forward/rollback transaction. EXCLUSIVE NOWAIT on parent/raw inventory/accounting tables rejects existing writers and holds new writers until commit, while permitting plain reads. Printing tables are not locked/changed. Short write delay is expected; no claim of zero delay.

## Verification ledger
Owned CI uses forward and rollback with the exact barrier. Active authenticated order writer must refuse barrier55P03 without stock/code mutation. Plain SELECT remains available during barrier; a new authenticated public send waits behind the exact barrier owner then completes/deducts once after release.
Initial Full38395140087 failed the mandatory worklog branch match because CURRENT_WORK_PLAN still pointed to #497's log. Corrected active plan pointer and structurally complete activation log; no test weakened. New exact-head CI required.

## Production gate
Owner approval PRESENT. State: **BLOCKED** until new exact-head Fast/Full success, unchanged live baseline/identity, tested same-transaction barrier, exact forward/rollback and post-apply catalog checks.
Production DDL uses project's migration API; preserve applied migration identity and reconcile generated version to repository history. Do not replay recovered historical migrations.

## Next action
Finish exact-head checks. Apply approved guarded forward with tested barrier and operator acknowledgement only on johnas. Verify expected bodies, existing ACL/security/trigger identity and revoked helpers. Save generated migration version and close history reconciliation/CI before finishing. On mismatch restore guarded original code, never undo committed business history.

## Mandatory update protocol
Fetch exact branch HEAD before EVERY sequential mutation. Stop/reconcile on drift. Stop writes during exact-head checks except real failures. Record approval, apply result and actual production version; pending is not success.


## Full bound-schema acceptance
Fast38395381062 passed the barrier and34 candidate cases. Before applying production, Full Verify now binds the SAME canonical forward bodies and barrier on owned localhost CI, so all existing integration/security/RLS tests exercise the deployed schema rather than an unwired baseline. Only original-versus-candidate benchmark fixture restores the archived original bodies INSIDE its BEGIN/ROLLBACK; all other tests remain bound. Owned COMMIT database handles an already-applied canonical migration by guarded rollback before its original/bound roundtrip. No source/table mutation or test assertions relaxed. New exact-head checks required. Applied migration20261013132245 archived verbatim after successful activation; history replay checks pending.


## Production activation result
2026-10-13 16:22 Cairo: after user renewed Supabase connection, apply_migration succeeded. Version `20261013132245`, name `kitchen_dedup_activation_20261013`; one history statement exactly equals the approved 58614-character payload including same-transaction barrier. Do NOT reapply to production.
All four original OIDs, owners, ACLs, security modes and search_path unchanged; all seven new body fingerprints match guarded rollback expectations. Three helpers invoker-only, ACL `{postgres=X/postgres}`. Broad tables, policies, triggers, constraints and all other functions fingerprints equal preflight. No production test order or physical print. Printing queue/agent/routes and all unrelated functions unchanged. Verify natural print delivery without claiming physical paper confirmation.
Before archive: exact3382651 Fast38396310980 and Full38396319723 GREEN (34 candidate,1708 frontend,1038 DB/RLS,132 Chromium). New archive requires fresh exact-head replay checks; branch remains BLOCKED until these pass.
