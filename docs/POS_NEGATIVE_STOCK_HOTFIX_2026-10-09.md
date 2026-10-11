# POS NEGATIVE STOCK HOTFIX — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/pos-negative-stock-client-guard-20261009`
Current PR: #484
Last updated: 2026-10-09

## Work status
State: **BLOCKED** pending exact-head Full Verify Green, staging smoke and explicit merge/deploy approval.

## Guardrails
- Do not change production DB, printing, Print Agent, KDS routing or station dispatch.
- Preserve server-authoritative stock deduction, raw negative FIFO debt and strict finished stock validation.
- Do not merge or deploy without exact-head CI Green and explicit approval.
- Maintain immutable kitchen send retry/idempotency and settlement accounting.

## Baseline
main@b3faf7afdb1d0130dc014017f51686b65789f319. POS workspace passes an empty stock map into usePosOrder while the hook enforces client-side stock preflight.

## Root-cause ledger
- POS catalog intentionally stock-agnostic, but cart mutations read absent stock as zero.
- Direct unpersisted sale also rejected against this zero-valued client snapshot.
- No proof yet that this explains every server kitchen-send incident; real RPC errors must be separately captured.

## Change ledger
- Removed stale UI-only cart and direct-sale stock guards in usePosOrderBase.ts.
- Added stock-agnostic UI and unchanged kitchen printing contract tests.
- No SQL, print utilities, kitchen dispatch, KDS or receipt code modifications.
- Scoped CURRENT_WORK_PLAN active log pointer to this PR branch to satisfy mandatory CI gate; the previous reporting work remains recorded in its separate document.

## Verification ledger
- Initial Verify main #3980 failed on the mandatory active worklog gate before lint/unit/build/DB/browser tests.
- Two-commit PR diff was checked: only hook and new contract test changed prior to documentation.
- Re-run full CI on the new exact PR head; validate staged POS add, increase, replace, direct sale, kitchen first-send/retry, negative raw debt, printing, Print Agent and station routing.
- No runtime browser, physical printer or production execution has been claimed.

## Production gate
- No Production migrations, DML, changes to printers, main merge or deploy authorized.
- Restore or reconcile the global work-plan active pointer with current ownership during final merge sequencing; never silently displace another workstream.

## Next action
- Run CI, inspect failing tests and correct only scoped regressions.
- Keep PR draft and blocked until full CI Green and approval.

## Mandatory update protocol
- Record each changed commit, CI ID/result and exact main baseline before requesting merge.
- Verify branch/PR head, main movement and active-work ownership immediately before any write or merge.
