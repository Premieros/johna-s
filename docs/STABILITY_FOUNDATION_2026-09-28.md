# STABILITY FOUNDATION — 2026-09-28

## Objective
Stabilize and simplify the existing live restaurant system without adding product features and without interrupting branch operations.

## Fixed identity
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Baseline main: `c22dfd69120201111944c04314b930ca3ad69889`
- Working branch: `development/stability-foundation-20260928`
- Live branches to preserve outside main:
  - `development/cleopatra-v811-final`
  - `development/smouha-v811-realtime-final`

## Non-negotiable safety gates
1. No direct write to `main`.
2. No force push.
3. No Production database write during investigation/refactor.
4. No Production migration before exact-head Full Verify is Green and explicit approval is recorded.
5. Printing, Print Agent, routing, KDS, and kitchen dispatch are frozen unless a proven regression requires a separately reviewed repair.
6. Permission-First and branch/RLS isolation may not be weakened.
7. Before every repository write, re-check the expected branch HEAD. Unexpected HEAD => STOP_AND_RECONCILE.
8. Each phase is small, reversible, and measured before/after.
9. Branches are live: runtime behavior must remain backward compatible until a verified merge.
10. No feature development in this track.

## Baseline findings
- Repository runtime/history is structurally mature but carries historical layers and oversized pages.
- Source of Truth was stale and referenced deleted branches/closed work.
- Production security advisor exposes 3 internal trigger functions to `anon`; these should be made non-client-callable without changing trigger execution.
- Production has a large SECURITY DEFINER surface; classify into public API vs internal helpers before narrowing grants.
- Realtime logs show repeated `JwtSignerError`; diagnose platform/JWT path before changing app code.
- Performance history since 2026-09-01 contains several RPCs with historical 0.6–1.7s mean latency and 7–8s maxima; current behavior must be re-baselined before optimization.
- Largest UI files include Reports, Import/Export, POS, Financial Reports, Super Admin.
- CI is strong but lacks one DB-backed restaurant Golden Path proving financial/stock reconciliation end-to-end.

## Execution phases

### Phase 0 — Repository truth and hygiene
- [x] Remove obsolete branches; preserve main + latest Cleopatra/Smouha print-agent branches.
- [x] Close dead/open PRs whose head branches were removed.
- [ ] Keep only the two latest print-agent PRs open.
- [x] Create this single stability branch and log.
- [ ] Replace stale CURRENT_WORK_PLAN with the exact active state.
- [ ] Remove/disable obsolete branch-cleanup workflow now that branch policy is explicit.

Gate: documentation/CI-only changes; Fast Verify Green.

### Phase 1 — Security surface, no behavioral change
- [ ] Add a forward-only migration that revokes client EXECUTE on the 3 internal trigger functions.
- [ ] Add regression tests proving triggers still execute through table writes while direct client execution is denied.
- [ ] Inventory SECURITY DEFINER functions into: public RPC / internal helper / trigger.
- [ ] Do not narrow other grants until each function has permission/RLS contract coverage.

Gate: Fresh DB + integration/RLS Green. Production migration remains blocked.

### Phase 2 — Realtime diagnosis
- [ ] Determine whether `JwtSignerError` is Supabase platform/config noise or application-triggered.
- [ ] Confirm app Realtime channel health for POS/work authorization/KDS read-only.
- [ ] Do not touch Print Agent or routing.

Gate: read-only Production evidence. Any configuration change requires separate approval.

### Phase 3 — Current performance baseline
- [ ] Add repeatable read-only benchmark script/contract for critical RPCs.
- [ ] Measure current main only, not accumulated pre-fix pg_stat_statements.
- [ ] Set budgets for POS, active orders, shifts, reports, treasury, costing, inventory ledger.
- [ ] Optimize only measured regressions; prefer query shape/call dedupe before adding indexes.

Gate: no user-visible behavior change; before/after evidence required.

### Phase 4 — Golden Path operational test
- [ ] Fresh DB scenario: login/authorization -> open shift -> table order -> kitchen send -> payment -> inventory/accounting -> shift close -> day close -> treasury/report reconciliation.
- [ ] Assert idempotency/retry and branch isolation.
- [ ] Keep printing execution mocked/frozen; verify print enqueue contracts only.

Gate: Golden Path Green in CI.

### Phase 5 — Heavy-page containment
- [ ] Reports: move data orchestration out of page into reporting domain/services.
- [ ] Dashboard: replace bulk transaction fetches with bounded aggregate RPCs.
- [ ] Financial Reports / POS / Import-Export / Super Admin: split orchestration from rendering in small safe steps.
- [ ] Enforce no new direct `supabase.from/rpc` access from page components except an explicit temporary allowlist.

Gate: UI behavior parity + Browser Smoke + performance evidence.

### Phase 6 — Offline and system health hardening
- [ ] Formalize online/degraded/offline/syncing/blocked states.
- [ ] Add bounded retry/backoff and failed/dead-letter handling for offline financial outbox.
- [ ] Clarify/remove unused order outbox if not part of the supported contract.
- [ ] Upgrade System Health from table-count checks to read-only operational invariants.
- [ ] Align CI/Deploy Node version.

Gate: offline regression tests + full verification.

## Production merge gate
A merge may be proposed only when:
- exact branch HEAD is known;
- Fast Verify Green;
- Full Verify Green (app, typecheck, lint, unit, build, fresh DB/schema, integration/security-RLS, browser smoke);
- Production API parity Green;
- no printing/KDS/agent runtime path changed unexpectedly;
- rollback is simply reverting the merge commit for code-only phases;
- any Production migration has a separate explicit approval.

## Change ledger
- 2026-09-28: branch cleanup completed: only main + latest Cleopatra/Smouha agent branches remain.
- 2026-09-28: obsolete PRs closed; #365 and #357 preserved.
- 2026-09-28: stability-foundation branch created from documented main baseline.

## Next action
Complete Phase 0 documentation/CI hygiene, then Fast Verify before any security migration implementation.
