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
Never deploy scripts/candidates SQL without validated production migration. Preserve role/branch/warehouse access, atomic rollback, approved branch price returned by the existing central function (current projection only indexes positive values; never manufacture zero), historical financial records and production inventory.

## Baseline
Atomicity fix PR #570 merged and separately applied to Supabase. PR #569 from older base has conflicts. November count drafts #00008 and #00009 not applied.

## Root-cause ledger
Original apply_count values shortage from FIFO while owner's policy requires last approved branch price. Candidate uses zero-quantity ledger revaluation to bridge FIFO outgoing cost and approved-price journal, not yet validated for all financial consumers.

## Change ledger
PR #571 rebases candidate and unit contract plus rollback-scoped local PostgreSQL integration case with zero-price surplus and FIFO-priced shortage onto current main. Owner direction reaffirmed: reuse the existing latest-price calculation path. Candidate now fails closed with APPROVED_RAW_PRICE_UNAVAILABLE if central pricing has no positive approved price. Replaced the zero-price fixture expectation with an atomic no-write rejection test. No new price calculation engine or price tables created.

## Verification ledger
GitHub Actions run 41292586447: browser-smoke, pages-continuity and db SUCCESS; verify FAILURE due to mandatory active-worklog contract requiring specific section headings and metadata. Worklog structure was corrected; the new head with fail-closed behavior still requires exact-head CI. Local tests have not been independently confirmed in this session.

## Production gate
BLOCKED: candidate SQL explicitly DO NOT DEPLOY, financial ledger bridge has not been independently reconciled with existing reporting; no tested production migration, no authorization to apply November counts while ledger and journal revaluation integration and reporting need review.

## Next action
Run exact-head CI, fix any integration regression, confirm accounting ledger/report value equality, then prepare audited migration and normal authorized application flow.

## Mandatory update protocol
Update this log after substantive code/test changes. Never claim deployment or post real inventory without verifying the production state.
