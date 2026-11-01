# GitHub Pages verified exact-commit deployment gate — 2026-11-01

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/github-pages-deploy-after-verified-main-20261101`
Current PR: #564
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
Candidate CI-only fix: make GitHub Pages publication depend on a successful full Verify main workflow for the exact latest main SHA. No DB migration, inventory adjustment or financial change.

## Guardrails
Do not merge until exact PR-head Verify main (verify, DB/RLS, browser smoke, pages continuity) succeeds. Do not deploy a stale or unverified commit. Preserve production parity checks and previous Pages assets for active sessions. No production SQL or customer stock writes.

## Baseline
Observed on 2026-11-01: GitHub Pages deploy run 41287567449 succeeded for main b7bbe5354a2ee595346432458a7b6e163959aa37 before independent Verify main run 41287567498 completed. All four Verify main jobs ultimately succeeded, but the publish gate did not wait for them. GitHub main branch reports protected=false and required_status_checks enforcement=off. Old PR-head run 41277116117 failed mandatory active worklog gate because the candidate branch had no matching first worklog declaration; browser, DB, pages continuity succeeded.

## Root-cause ledger
The deploy workflow uses `push` as an independent trigger, with build and API-contract checks only. It cannot prove that the full integration, authorization, unit, TypeScript and browser suites succeeded. The previous candidate also omitted a PR-head matching worklog declaration.

## Change ledger
Switch Pages to `workflow_run` completed-success for Verify main push on the same repository's main/master; checkout verified `head_sha` in both build and production-parity; refuse stale branch HEAD before build and immediately before deploy. Add code-only unit contract and this required worklog entry.

## Verification ledger
2026-11-01: Production Pages deploy 41287567449 and full Verify main 41287567498 both succeeded for b7bbe5354a2ee595346432458a7b6e163959aa37, but in unsafe order. Earlier candidate PR #564 exact-head Verify main 41277116117 failed worklog gate, other three suites passed. This log/plan correction needs a new exact-head PR CI run.

## Production gate
BLOCKED until four mandatory PR checks pass at updated head and reviewer confirms the event permissions and release sequence. After merge, explicitly verify that a fresh main commit publishes only after Verify main success; merge alone is not a Pages deployment. No Supabase migration is involved.

## Next action
Run updated PR #564 exact-head CI; inspect any failure; review, then controlled merge if green. Observe first GitHub Pages workflow_run event and verify deployed SHA equals latest tested main.

## Mandatory update protocol
Update this log for material findings, CI evidence and release status. Keep code merge, GitHub Pages publish and Supabase migrations separate; do not claim production release without GitHub Pages deploy success.
