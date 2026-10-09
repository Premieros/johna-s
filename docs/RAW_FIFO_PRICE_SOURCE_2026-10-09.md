# RAW FIFO PRICE SOURCE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/raw-fifo-price-source-20261009`
Current PR: pending

## Work status
State: IN VERIFICATION. No production database write.

## Guardrails
- Prefer positive recorded FIFO inventory unit cost for material price display.
- Otherwise preserve last known positive user-recorded price.
- Leave never-priced materials with null price; never invent or store a price.
- Preserve permissions, isolation, accounting and stock quantities.

## Baseline
Material pages and costing reports read latest prices and FIFO values independently.

## Change ledger
- Centralized FIFO-first read with known price fallback.
- Updated raw materials, costing center and station report consumers.
- Added tests for FIFO precedence and unpriced materials.

## Verification ledger
- Exact-head CI pending.

## Next action
Complete full verification and review results before merging.
