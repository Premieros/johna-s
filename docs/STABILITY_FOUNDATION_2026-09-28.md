# STABILITY FOUNDATION — 2026-09-28

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/stability-foundation-20260928`
Current PR: `#401`
Last updated: 2026-09-28 15:24 Africa/Cairo

## Work status
State: **BLOCKED**

The track is active on a development branch only. Production writes and Production migrations are blocked until the exact final head passes Full Verify and the user explicitly approves the Production step. The live restaurant branches must remain operational throughout this work.

## Guardrails
1. No direct write to `main`.
2. No force push.
3. No Production database write during investigation/refactor.
4. No Production migration before exact-head Full Verify is Green and explicit approval is recorded.
5. Printing, Print Agent, routing, KDS, and kitchen dispatch are frozen unless a proven regression requires a separately reviewed repair.
6. Permission-First and branch/RLS isolation may not be weakened.
7. Before every repository write, verify the expected branch HEAD. Unexpected HEAD => STOP_AND_RECONCILE.
8. Each phase must be small, reversible, and measured before/after.
9. Runtime behavior must remain backward compatible for currently operating branches.
10. No feature development in this track.

## Baseline
- Production main at track start: `c22dfd69120201111944c04314b930ca3ad69889`.
- Long-lived branches intentionally preserved: `main`, `development/cleopatra-v811-final`, `development/smouha-v811-realtime-final`.
- Latest Print Agent PRs intentionally preserved: #365 Cleopatra and #357 Smouha.
- Repository contains mature CI, Permission-First/RLS tests, Fresh DB validation, Browser Smoke, Offline POS, and Production API parity.
- Production data volume is modest relative to observed latency; current performance risk is call/query shape and repetition rather than raw database size.
- Historical `pg_stat_statements` data is accumulated since 2026-09-01 and must not be treated as a current benchmark without remeasurement.

## Root-cause ledger
### R1 — Source of Truth drift
The previous unified work plan contained many historical sections still marked ACTIVE and referenced branches that no longer exist. This can send future work to stale baselines.

### R2 — Internal RPC surface is broader than necessary
Supabase Advisor reports 3 internal trigger functions executable by `anon` and a large SECURITY DEFINER surface for authenticated users. The three trigger functions are implementation helpers, not intended client APIs.

### R3 — Realtime health signal
Production Realtime logs contain repeated `JwtSignerError: Failed to generate JWT signer, check your JWT secret or JWKS configuration`. This requires diagnosis before any app-side Realtime change.

### R4 — Historical latency / call amplification
Historical stats show several RPCs with high mean/max latency. Because stats include pre-fix traffic, a new current-main benchmark is required before tuning.

### R5 — Heavy page orchestration
Reports, Import/Export, POS, Financial Reports and Super Admin remain oversized; several page components still talk directly to Supabase instead of a narrow domain boundary.

### R6 — Missing single DB-backed operational Golden Path
CI is strong at contracts/components/RLS/browser smoke, but no one test currently proves the full restaurant financial/stock cycle end-to-end on a real fresh database.

### R7 — Offline lifecycle is partially formalized
Offline sale outbox is robust in several ways but lacks a formally bounded retry/backoff/dead-letter lifecycle and a single explicit device-state model.

### R8 — System Health is reachability-oriented
Current System Health verifies table/session reachability, not the full operational invariants needed to say a restaurant branch is ready to operate.

## Change ledger
- 2026-09-28: repository branches cleaned to `main` + latest Cleopatra/Smouha agent branches.
- 2026-09-28: obsolete PRs with deleted heads closed; #365 and #357 preserved.
- 2026-09-28: created `development/stability-foundation-20260928` from `main@c22dfd69120201111944c04314b930ca3ad69889`.
- 2026-09-28: created Draft PR #401.
- 2026-09-28: created this mandatory execution log.
- 2026-09-28: replaced stale active-work sections in `CURRENT_WORK_PLAN.md` with the stability track.
- 2026-09-28: removed obsolete automatic branch-cleanup workflow.
- 2026-09-28: added branch-only trigger execute-boundary migration and regression coverage; no Production migration applied.
- 2026-09-28: isolated Playwright Realtime WebSockets from Production; follow-up Production logs showed zero `JwtSignerError` in the verification window.
- 2026-09-28: hardened offline outbox with bounded retry/backoff plus blocked/dead-letter states and manual recovery.
- 2026-09-28: exact-head Fast Verify + Full Verify Green on `3d8b9bf076a929f889d65115ec96898733b1db6b`.

## Verification ledger
- Branch baseline identity: verified against documented main SHA before branch creation.
- Production status inspection: read-only only.
- Security advisor: read-only inspection complete; no grants changed.
- Performance stats: read-only inspection complete; no DB config/query changes applied.
- Fast Verify: **GREEN** on `3d8b9bf076a929f889d65115ec96898733b1db6b` — run `36424534608`.
- Full Verify: **GREEN** on `3d8b9bf076a929f889d65115ec96898733b1db6b` — run `36424539517`; verify/db/browser-smoke all Green.
- Production API parity: pending on final candidate head.
- Production migration: not applied.

## Production gate
State: **BLOCKED**

Unblock conditions:
1. exact candidate head is documented;
2. Fast Verify Green;
3. Full Verify Green: app/type/lint/unit/build + Fresh DB/schema + integration/security-RLS + Browser Smoke;
4. Production API parity Green;
5. no unexpected printing/KDS/agent runtime path change;
6. any Production migration has a separately documented user approval.

## Execution plan
### Phase 0 — Repository truth and hygiene
- [x] Remove obsolete branches; preserve main + latest Cleopatra/Smouha agents.
- [x] Close dead/open PRs whose branches were removed.
- [x] Create one stability branch and one mandatory log.
- [x] Replace stale CURRENT_WORK_PLAN.
- [x] Remove obsolete automatic branch-cleanup workflow.
- [x] Run Fast Verify.

### Phase 1 — Security surface, no intended behavior change
- [x] Add forward-only migration revoking client EXECUTE on the 3 internal trigger functions (branch only; not applied to Production).
- [x] Add regression coverage proving trigger attachment stays enabled and direct client invocation is denied.
- [ ] Classify SECURITY DEFINER functions into public RPC / internal helper / trigger.
- [ ] Do not narrow any other grants until the function has explicit permission/RLS coverage.

### Phase 2 — Realtime diagnosis
- [x] Diagnose `JwtSignerError`: E2E Playwright fake JWTs were reaching Production Realtime.
- [x] Isolate E2E Realtime WebSockets; Production read-only log check from 12:33Z–13:10Z showed **0 JwtSignerError**.
- [ ] Do not modify Print Agent/routing.

### Phase 3 — Current performance baseline
- [ ] Add repeatable read-only benchmark for critical RPCs/routes.
- [ ] Measure current main behavior instead of accumulated pre-fix history.
- [ ] Document latency budgets.
- [ ] Optimize measured regressions only, preferring call dedupe/query shape before new indexes.

### Phase 4 — Golden Path operational test
- [ ] Fresh DB: authorization → shift → table order → kitchen send → payment → inventory/accounting → shift close → day close → treasury/report reconciliation.
- [ ] Assert retry/idempotency and branch isolation.
- [ ] Printing execution remains mocked/frozen; only enqueue contracts are asserted.

### Phase 5 — Heavy-page containment
- [ ] Reports data orchestration behind reporting domain/services.
- [ ] Dashboard bounded aggregate data instead of bulk transaction reads.
- [ ] Gradually split POS / Import-Export / Financial Reports / Super Admin orchestration from rendering.
- [ ] Enforce no new direct page-level Supabase access except an explicit temporary allowlist.

### Phase 6 — Offline + health + CI hardening
- [ ] Formalize online/degraded/offline/syncing/blocked states.
- [x] Add bounded exponential retry/backoff plus blocked/dead-letter lifecycle; manual retry remains available.
- [ ] Resolve unsupported/unused order outbox contract.
- [ ] Expand System Health to operational invariants.
- [ ] Align Verify/Deploy Node runtime.

## Next action
Phase 0 is complete. Continue Phase 3 with a fresh production read-only latency/call baseline, then implement only measured performance reductions. Phase 1 grant migration remains branch-only until the final Production gate.

## Mandatory update protocol
- Read this file before every write.
- Verify active branch HEAD before every write and compare it with the prior successful checkpoint.
- Update Change ledger after every coherent change set.
- Update Verification ledger after every test/measurement with the exact result/run when available.
- If a tool error, conflict, unexpected HEAD, or interrupted operation occurs: STOP_AND_RECONCILE before any retry.
- Keep Production gate blocked until all listed conditions are explicitly satisfied.
