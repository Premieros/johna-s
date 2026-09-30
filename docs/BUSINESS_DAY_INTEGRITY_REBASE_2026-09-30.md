# BUSINESS DAY INTEGRITY REBASE — 2026-09-30

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/business-day-integrity-rebase-20260930`
Current PR: pending creation after first commit
Baseline: `main@975fa9bfc2ee07f306f5cfd9b46cf04eb1748057`
State: **BLOCKED** — no merge, Production migration, or Production data correction is authorized.

## Why this track exists
Emergency financial/readings corrections merged after the former post-402 stability branch diverged from main. The former branch is not a safe merge source.

Read-only Production check on 2026-09-30:
- Cleopatra: business_date=2026-09-30; max closed date=2026-09-29; one open shift.
- Smouha: business_date=2026-10-03; max closed date=2026-10-02; no open shift.
- Therefore treasury business-day reconciliation fixed reporting boundaries, but did not eliminate future business-day state/close drift.

## Scope
Only:
1. prevent manual rollover before configured cutoff;
2. prevent future daily_close rows from dragging live state forward;
3. prevent a corrupted future state from rolling farther forward;
4. prevent no-open-shift day_close from closing a business day before its configured cutoff;
5. preserve emergency treasury/readings fixes already on main.

Frozen:
- Treasury reconciliation formulas from PR #409/#410 and later corrections.
- Supplier/accounting fixes #413/#415/#416/#417/#418.
- Printing / Print Agent / routing / KDS / send_to_kitchen.
- Inventory authority.
- Payment semantics until this phase is independently Green.

## Guardrails
- No direct write to main; no force push.
- Single writer.
- Unexpected HEAD => STOP_AND_RECONCILE.
- No RLS/permission weakening.
- No Production migration before exact-head Full Verify + parity Green + explicit approval.
- No Production data rewrite to make tests pass.
- Historical future daily_closes/business_day_state correction is a separate protected step.

## Design decision
The former guard used only business_day_start to compute the maximum reachable state. This rebase must be cutoff-aware so the legitimate post-cutoff/pre-next-start interval is handled correctly.

## Verification gate
Required before any Production proposal:
- lint/typecheck/unit/build Green;
- canonical migrations/schema Green;
- integration/security/RLS Green;
- Browser Smoke Green;
- latest-main drift check;
- Production API parity;
- read-only Smouha/Cleopatra validation.

## Next action
Implement the minimal cutoff-aware state/rollover/day_close guard on this branch, add regression coverage, verify exact head, then stop before Production/merge.
