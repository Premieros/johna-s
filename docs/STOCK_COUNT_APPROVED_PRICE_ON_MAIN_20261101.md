# Approved-price stock count candidate — refreshed on main
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-approved-price-on-main-20261101`
Current PR: `#571`
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
Source-only approved-price stock-count candidate rebased onto atomicity-fixed main. No production price migration or November stock count applied.

## Guardrails
Never deploy scripts/candidates SQL without validated production migration. Preserve role/branch/warehouse access, atomic rollback, approved branch price including valid zero, historical financial records and production inventory.

## Baseline
Atomicity fix PR #570 merged and separately applied to Supabase. PR #569 from older base has conflicts. November count drafts #00008 and #00009 not applied.

## Root-cause ledger
Original apply_count values shortage from FIFO while owner's policy requires last approved branch price. Candidate uses zero-quantity ledger revaluation to bridge FIFO outgoing cost and approved-price journal, not yet validated for all financial consumers.

## Change ledger
PR #571 rebases candidate and unit contract plus rollback-scoped local PostgreSQL integration case with zero-price surplus and FIFO-priced shortage onto current main. Latest change is documentation gate correction after Verify failed.

## Verification ledger
GitHub Actions run 41292586447: browser-smoke, pages-continuity and db SUCCESS; verify FAILURE due to mandatory active-worklog contract requiring specific section headings and metadata. This file fixes those structural deficiencies. Exact-head CI must be rerun.

## Production gate
BLOCKED: candidate SQL explicitly DO NOT DEPLOY, no tested production migration, no authorization to apply November counts while ledger and journal revaluation integration and reporting need review.

## Next action
Run exact-head CI, fix any integration regression, confirm accounting ledger/report value equality, then prepare audited migration and normal authorized application flow.

## Mandatory update protocol
Update this log after substantive code/test changes. Never claim deployment or post real inventory without verifying the production state.
