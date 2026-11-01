# Stock count pricing release gates — 2026-11-01

Production: azzdesuowpdcoflmyezn. Count IDs #00008 Smouha, #00009 Cleopatra; both remain drafts.

## Owner policy
Valuation must use last approved price for material and branch as-of physical count, with zero only when no approved price exists. Do not substitute FIFO, avg_cost or unapproved new cost. Never rewrite historical posted invoices.

## Confirmed live blockers
- Both counts are drafts and have 809 total items.
- Existing create_stock_count stores avg_cost; apply_stock_count calls _raw_remove_fifo and derives shortage valuation from FIFO total_cost. A draft price update alone does not guarantee the correct journal.
- Existing trigger raw_price_source_change on stock_count_items.unit_cost calls private.sync_raw_approved_price_source. That trigger can write the price read model. Updating a draft directly before defining an exclusion/gate risks circular or self-referential source pricing.
- The approved price read model includes purchase, pricing, and stock_count sources, requiring explicit source approval/period verification.
- The stock_count apply function has a known potential partial-posting failure when a later line returns an error JSON. Fix candidate #565 must be verified and deployed before applying 809 lines.
- Physical count timestamps are not proven equal to created_at, and post-count warehouse movements must be reconciled before posting.

## Before any production data mutation
1. Define as-of timestamp from physical count and show operator source provenance (purchase/pricing/eligible posted count only) and missing-price=0 policy.
2. Prevent draft stock count items from becoming authoritative approved-price sources; retain approved historical lineage.
3. Implement consistent journal valuation for both positive and negative raw variances without FIFO historical debt replay; preserve quantity and batch guards, permission, branch/warehouse scope and idempotency.
4. Test early/later failure atomic rollback, sale/return consistency, zero-price, missing-price, duplicate line and reversal against disposable Postgres.
5. Confirm neither count is already posted, verify no post-count stock events, then prepare an auditable, previewed transaction with finance approval. No bypassing submit/approve/apply authorization.
6. Require four-job exact-head CI and explicit production rollout confirmation.

## Status
BLOCKED. This document is not a financial migration or application authorization. Do not apply the existing function to these counts or relabel them as applied.
