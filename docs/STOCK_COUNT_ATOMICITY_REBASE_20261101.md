# Atomic stock count apply on main — 2026-11-01
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-atomicity-rebase-20261101`
Current PR: #570
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
Rebase of atomic error rollback from PR #565 onto current main, to avoid PR #565 conflicts. This change is independent from PR #569 latest-approved-price cost calculation.

## Guardrails
Do not mutate customer data directly. Do not apply November drafts #00008 or #00009. Preserve authorization, branch/warehouse rules, existing FIFO until separate costing migration is tested, and historical journals. No bypass of submit/approve/apply permissions.

## Baseline
Production public.apply_stock_count has early false-return paths inside a nested PL/pgSQL block after partial item writes. When an error occurs in later item, previous mutations may commit.

## Root-cause ledger
Returning JSON from the nested execution block does not roll back previous statements, whereas raising an exception from inside the block and catching it outside that same nested block does.

## Change ledger
Port the existing atomicity migration and disposable database regression from PR #565 to a clean branch on current main. Make no price engine or business data changes.

## Verification ledger
Original PR #565 exact-head Verify main run 41277751045 completed success. Rebased PR #570 requires a fresh four-job exact-head CI. No production rollout yet.

## Production gate
BLOCKED until all current exact-head tests succeed, CI database integration proves full rollback, code review, and deployment applied to production. This does not authorize applying current count drafts with uncorrected FIFO cost logic.

## Next action
Run PR #570 checks, correct test fixture version and any issues, merge only after green full CI, confirm production migration. Keep PR #569 as separate financial cutover.

## Mandatory update protocol
Update work log after material changes and CI, never falsely claim release, no financial production writes without verified safeguards.
