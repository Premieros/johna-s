# BUSINESS DAY INTEGRITY REBASE — 2026-09-30

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/business-day-integrity-rebase-20260930`
Current PR: `#419`
Last updated: 2026-09-30
State: **BLOCKED**

## Guardrails
- No direct write to `main`; no force push.
- Single writer only.
- Unexpected HEAD => **STOP_AND_RECONCILE**.
- No RLS, Permission-First, branch-isolation, or Super Admin bypass weakening.
- Treasury reconciliation formulas from PR #409/#410 and later emergency financial corrections are frozen.
- Supplier/accounting corrections #413/#415/#416/#417/#418 are frozen.
- Printing / Print Agent / routing / KDS / `send_to_kitchen` are frozen.
- Inventory and payment semantics are frozen for this phase.
- No Production migration before exact-head Full Verify + Production parity Green + explicit approval.
- No Production data rewrite/reset/reseed to pass tests.
- Historical future `daily_closes` / `business_day_state` correction is a separate protected step.

## Baseline
- Base: `main@975fa9bfc2ee07f306f5cfd9b46cf04eb1748057`.
- Former branch `development/post-402-stability-closure-20260929` is diverged and is not a merge source.
- Emergency treasury/readings corrections are treated as protected baseline.
- Read-only Production check on 2026-09-30:
  - Cleopatra: `business_date=2026-09-30`, max closed date `2026-09-29`, one open shift.
  - Smouha: `business_date=2026-10-03`, max closed date `2026-10-02`, no open shift.
- Therefore treasury reporting boundaries were repaired, but future Business Day state drift still exists independently.

## Root-cause ledger
1. `rollover_business_day` can be called before the configured cutoff.
2. Repeated manual rollover can create future `daily_closes`.
3. `_ensure_business_day_state` trusts the highest close and can propagate that future date into later state.
4. `day_close` with no open shift can finalize a supplied future/not-due business date without a cutoff guard.
5. PR #410 repaired treasury grouping/readings by configured Business Day boundaries, but it does not replace the state/rollover functions above.
6. The former integrity guard used only `business_day_start` for its ceiling, which is incomplete during the post-cutoff/pre-next-start interval; the rebased guard is cutoff-aware.

## Change ledger
- Created this branch from exact latest main baseline.
- Opened Draft PR #419.
- Added `supabase/migrations/20260930064000_business_day_integrity_rebase.sql`.
- Added `private.current_fixed_business_date` for the clock Business Day date.
- Added `private.max_reachable_business_state_date` for a cutoff-aware state ceiling.
- Refined no-open-shift `day_close`: valid manual close dates at or behind the reachable state ceiling remain allowed; only future/not-reachable dates are blocked. Open-shift rollover remains cutoff-enforced.
- Replaced `_ensure_business_day_state` so future historical closes cannot drag a new live state beyond the reachable ceiling.
- Replaced `rollover_business_day` so rollover before cutoff returns `BUSINESS_DAY_NOT_FINISHED`, advances exactly one day, and refuses to skip over a preclosed next date.
- Replaced `day_close` so no-open-shift closes also require the configured cutoff and cannot advance state beyond the reachable ceiling.
- Added unit and integration regression coverage, including the 02:30 cutoff / 08:00 next-start interval and open-shift rows with missing `opened_at`.
- Updated the existing rollover integration test to require a genuinely due date and to assert immediate second rollover is blocked.
- No treasury formula, printing, KDS, inventory, supplier, or payment code was changed.

## Verification ledger
- Verify #3525 / run `36679061600`: failed only at mandatory active-worklog structure before lint/typecheck/unit/build; DB and Browser Smoke were skipped.
- Failure cause: this log did not yet contain every mandatory structural heading and declared `Current PR: pending`.
- Verify #3526 / run `36680984404`: application gate Green; DB integration failed 4 tests and exposed an over-strict no-open-shift manual-close guard plus new-test isolation issues.
- Verify #3529 / run `36681680172`: application gate Green; DB integration reached 874/877 passed.
- Verify #3532 / run `36683439029`: application gate Green; DB integration 874/878 passed. The added `opened_at=NULL` fixture was invalid because `shifts.opened_at` is NOT NULL.
- Verify #3535 / run `36684881710`: application/unit/build Green; DB integration 874/878 passed. Root cause isolated in `day_close`: after the future-date guard was refactored, `v_cutoff` was assigned only inside the rejected-future branch. Valid closes later advanced `business_day_state.started_at=v_cutoff` with NULL. Fixed by resolving `private.business_day_fixed_cutoff(...)` unconditionally before the reachability check. The date-format regression assertion also had an over-escaped regex and was corrected.
- Verify #3538 / run `36687420644`: application/unit/build Green; DB integration improved to 877/878 passed. All existing operational suites passed, including `functional_core_cycle`, `shift_day_close_expense_gl`, rollover, auto-close, print, KDS, inventory, and permission/security suites. The only failure was in the new regression test because one SQL SELECT both invoked `_ensure_business_day_state()` and read the table in a sibling subquery; PostgreSQL may evaluate the read first. Test was corrected to execute mutation and verification as separate statements. No production code change was needed.
- Branch remains based on `main@975fa9bfc2ee07f306f5cfd9b46cf04eb1748057`; no Production write or merge has occurred.

## Production read-only verification — 2026-09-30
- Exact-head Verify #3540 / run `36695015715`: **GREEN** across application, unit, build, DB integration/security, and Browser Smoke.
- Production functions are still the old unguarded versions; no Production migration has been applied.
- Cleopatra is healthy at `business_date=2026-09-30`, one open shift, max closed date `2026-09-29`.
- Smouha is still corrupted at `business_date=2026-10-03` with one open shift; max closed date is `2026-10-02`.
- Smouha future daily closes:
  - 2026-09-30: zero snapshot, created 2026-09-28.
  - 2026-10-01: snapshot contains 19 invoices / net sales 5,885 / cash snapshot 3,391, created 2026-09-29.
  - 2026-10-02: zero snapshot, created 2026-09-29.
- The 2026-10-01 snapshot exactly matches the second Smouha shift on 2026-09-29 by invoice count and net sales: 19 invoices / 5,885.
- Correct 2026-09-29 source data is broader than that snapshot: 29 completed sales / 9,189 total, 4 purchases / 8,648, 9 non-voided expenses / 25,799.99.
- Current Smouha activity on 2026-09-30 at read time: 2 completed sales / 250 total, 8 orders created in the current-day window, 6 open/held orders.
- Therefore the historical repair MUST NOT simply rename/relabel the 2026-10-01 snapshot as 2026-09-29.
- No historical correction is permitted while the live Smouha shift has open orders.
- Required repair shape after a safe maintenance point:
  1. preserve invalid future snapshots in an audit-safe form before mutation;
  2. rebuild the correct 2026-09-29 close from canonical source tables;
  3. remove only invalid future close rows after preservation/reconciliation;
  4. reset `business_day_state` to the actual reachable date;
  5. verify treasury/day-close/report parity before reopening automatic rollover;
  6. keep this data repair separate from the code guard migration.

## Production gate
State: **BLOCKED**
- Exact-head Verify Green: YES — #3540 / `36695015715` on code head `db848343d9c8d766905d48d348dbd77f5f53b704` before this documentation-only update.
- Exact-head Full Verify on the final documentation head: pending rerun.
- Production API parity Green: NO.
- Production migration approved: NO.
- Production migration applied: NO.
- Historical Production correction approved: NO.
- Merge approved: NO.

## Next action
1. Re-run exact-head Verify after this documentation-only update.
2. Re-check latest `main` drift.
3. Prepare a separate, reviewable historical-reconciliation script/plan for Smouha; do not execute it while the live shift/open orders exist.
4. Keep code-guard migration and historical data repair as separate approvals.
5. Stop before any Production migration, data correction, or merge for explicit approval.

## Mandatory update protocol
- Verify branch HEAD before every repository write.
- Read this log and `docs/CURRENT_WORK_PLAN.md` before every protected write.
- Unexpected HEAD movement => **STOP_AND_RECONCILE**.
- Record every code/data-shape change and every CI run/result here.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while PR #419 is active.
- No merge, Production migration, or historical data correction until the required exact-head gates are Green and explicit approval is recorded.
