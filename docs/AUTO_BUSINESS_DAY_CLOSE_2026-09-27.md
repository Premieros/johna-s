# AUTO BUSINESS DAY CLOSE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/auto-business-day-close-20260927`
Current PR: `#0`
Last updated: 2026-09-27 Africa/Cairo

## Work status

State: **BLOCKED**

Goal: execute business-day close automatically at each branch's configured fixed-time end without requiring a logged-in user or an open browser session.

## Guardrails

- Base: `main@d1d56620c4d7cefe31d1cb4207474d17dd7b7347`.
- No direct write to `main`; no force push.
- Do not touch printing, Print Agent, routing, KDS, send-to-kitchen, POS table binding, or inventory.
- Preserve open shifts and open orders at business-day rollover.
- Permission-First remains unchanged for user-triggered day-close RPCs.
- Automatic close uses a private database worker only; it is not exposed to authenticated/anon clients.
- Only branches in `fixed_time` mode are eligible for timed automatic close.
- No Production migration until exact-head Full Verify is Green and Production approval is recorded.

## Baseline

- Production has no `pg_cron` or `pg_net` extension enabled and no database scheduler.
- Cleopatra fixed-time settings: start 08:00, end 02:30 Africa/Cairo.
- Smouha fixed-time settings: start 08:00, end 03:00 Africa/Cairo.
- Cleopatra has no `daily_closes` rows for 2026-09-26 or 2026-09-27.
- Cleopatra 2026-09-26 has 86 completed sales and 6 closed shifts.
- Cleopatra 2026-09-27 has completed sales plus one closed and one open shift.
- Existing `day_close` / `rollover_business_day` RPCs require `auth.uid()`, so they cannot be invoked directly by a database background worker.
- `daily_closes.closed_by` is nullable, which supports explicit system-generated closes without impersonating an employee.

## Root-cause ledger

1. Business-day close logic exists, but there is no scheduler invoking it at the configured end time.
2. Browser/UI-driven close cannot guarantee automatic execution when no authorized user has the page open.
3. A cron worker runs without `auth.uid()`, therefore reusing the public permission-gated RPC directly would fail with AUTH_REQUIRED.
4. Missing historical due days must be closed from the canonical fixed-time window, not by changing sale/shift data.
5. For a currently active day, state must advance at the exact configured cutoff before building the immutable snapshot so activity after the cutoff cannot leak into the prior day.

## Change ledger

- Created isolated branch from exact latest main.
- Read-only Production inspection completed.
- Added `20260927095000_auto_business_day_close.sql`.
- Added private `business_day_fixed_cutoff(branch,date)` using branch-configured start/end in Africa/Cairo.
- Added private idempotent `run_due_business_day_closes()` worker.
- Worker catches up the earliest due unclosed date after the latest close.
- For the currently active day, state advances at the exact configured cutoff before snapshot creation, preserving the open shift while keeping post-cutoff activity out of the prior snapshot.
- System closes use `closed_by = NULL`.
- Scheduler installation enables `pg_cron` when available and schedules the worker every minute as `auto-business-day-close`.
- Normal app roles cannot execute the private worker.
- Added unit contract and DB integration coverage for exact cutoff, preserved open shift, idempotency, and privilege isolation.

## Verification ledger

- Production baseline inspection: complete, read-only.
- Focused tests: committed; CI pending.
- Full Verify: pending.

## Production gate

State: **BLOCKED**

Production migration is not yet applied. Exact-head Full Verify and explicit Production approval are required.

## Next action

Open Draft PR, bind the mandatory log to its PR number, and run exact-head Full Verify. No Production apply before Green.

## Mandatory update protocol

- Before every repository write, fetch branch HEAD and require the expected checkpoint.
- Unexpected HEAD movement = STOP_AND_RECONCILE.
- Update Change ledger after each logical implementation group.
- Update Verification ledger after every CI run.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this log while this PR is active.
- No Merge or Production migration until exact-head Full Verify is Green and approval is recorded.
