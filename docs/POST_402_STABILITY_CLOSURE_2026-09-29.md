# POST-402 STABILITY CLOSURE — 2026-09-29

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/post-402-stability-closure-20260929`
Current PR: `#408`
Last updated: 2026-09-29
State: **BLOCKED** — Production writes and merge remain blocked by verification gates.

## Guardrails
- Single writer only.
- No direct writes to `main`.
- No force push.
- Unexpected HEAD => **STOP_AND_RECONCILE**.
- No weakening Permission-First, branch isolation, RLS, tests, or Super Admin implicit bypass.
- Printing / Print Agent / routing / KDS / `send_to_kitchen` / shifts remain frozen unless a specific regression is proven.
- No Production migration before Fast Verify Green + Full Verify Green + Production parity Green + explicit user approval.
- No Production data rewrite/reset/reseed to make tests pass.
- Smouha and Cleopatra must remain operational throughout the work.

## Baseline
- Production branch: `main`.
- Baseline: `main@5c74a25448afb65c4e3b528751f749215162cd1b`.
- PR #402 is merged and deployed.
- PR #402 post-merge verification is recorded as Green.
- The `order_items.id` identity hotfix for transfer/resume/split/Void is already present on `main`.
- The former #402 branch/log are historical only and are not an active execution track.

## Root-cause ledger
- Source-of-truth drift: `docs/CURRENT_WORK_PLAN.md` still described PR #402 as active after merge.
- The former #402 worklog still declared development on #402 active.
- Post-merge live checks identified a P0 business-day anomaly requiring a new bounded stability track rather than reopening #402.

## Change ledger
- 2026-09-29: created branch `development/post-402-stability-closure-20260929` from exact `main@5c74a25448afb65c4e3b528751f749215162cd1b`.
- 2026-09-29: opened this post-#402 stability closure log.
- Next planned work: Source-of-Truth closure, then Business Day / Auto Close Integrity before payment, performance, heavy-page, runtime, print-observability, DB-hygiene, security-surface, and System Health work.



### 2026-09-29 — Business-day P0 root cause
- Production read-only evidence confirmed current state drift: Cleopatra business_date=2026-09-30 and Smouha business_date=2026-10-01 while Cairo date is 2026-09-29.
- Future daily_close rows were user-attributed, not system cron closes. Smouha closed 2026-09-28 and 2026-09-29 twelve seconds apart, then 2026-09-30 on 2026-09-28.
- Root cause chain:
  1. `rollover_business_day/day_close` allowed rollover before the configured cutoff.
  2. Repeated rollover created future `daily_closes`.
  3. `_ensure_business_day_state` trusted the highest historical close and advanced a later shift to `last_close + 1`, propagating the future date.
- Branch-only fix added in `20260929223000_business_day_integrity_guard.sql`:
  - bounds live state to the clock-reachable business date;
  - blocks rollover before configured cutoff;
  - advances exactly one date;
  - refuses to skip over an already-closed next date.
- Contract test added at `tests/unit/businessDayIntegrityGuardContract.test.ts`.
- No Production migration or historical data correction has been applied.

## Verification ledger
- Baseline main commit confirmed: `5c74a25448afb65c4e3b528751f749215162cd1b`.
- Production Supabase project confirmed ACTIVE_HEALTHY.
- Exact-head verification for this branch has not yet run.

## Production gate
Production writes: **BLOCKED**.
No Production migration or data mutation is authorized by this track without the documented verification gates and explicit approval.

## Next action
1. Correct `docs/CURRENT_WORK_PLAN.md` and close the #402 log as historical.
2. Inspect Production read-only business-day state for Smouha and Cleopatra.
3. Trace `business_day_state -> daily_close -> auto day close -> auto shift close -> next business day calculation`.
4. Fix only the proven root cause on this branch.
5. Verify exact head and stop before any merge.

## Mandatory update protocol
- Read this file before every write.
- Verify expected branch HEAD before every write.
- Record each coherent change set and verification result.
- Unexpected HEAD => **STOP_AND_RECONCILE**.
- Do not perform Production writes without the required gates and explicit approval.
