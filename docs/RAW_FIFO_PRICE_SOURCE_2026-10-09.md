# RAW FIFO PRICE SOURCE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/raw-fifo-price-source-20261009`
Current PR: #481

## Work status
Last updated: 2026-10-09
State: **BLOCKED** pending exact-head CI. No production database write.

## Guardrails
- Prefer positive recorded FIFO inventory unit cost for material price display.
- Otherwise preserve last known positive user-recorded price.
- Leave never-priced materials with null price; never invent or store a price.
- Preserve permissions, isolation, accounting and stock quantities.

## Baseline
Material pages and costing reports read latest prices and FIFO values independently.

## Root-cause ledger
- Materials pages and reports previously called separate current-price and FIFO readers; historical saved price was not consistently used as fallback when the FIFO cost was unavailable.
- Keep FIFO inventory accounting separate from last-known user prices; never synthesize a price for unpriced materials.

## Change ledger
- Centralized FIFO-first read with known price fallback.
- Updated raw materials, costing center and station report consumers.
- Audited and unified the additional pricing consumers: purchasing forms, low stock, product setup, recipe estimates, manufacturing recipes, catalog pricing, import/export, and shift closing.
- Prevented the purchase form refresh from replacing a saved raw-material cost with a synthetic zero.
- Added a code contract test covering all 13 UI/data consumers.
- Added tests for FIFO precedence and unpriced materials.

## Verification ledger
- Exact-head CI pending.

## Production gate
State: **BLOCKED** until exact-head Full Verify is green and final review is complete. No production SQL migration is necessary.

## Mandatory update protocol
- Confirm the active branch HEAD and current main before writes.
- Record verification results and stop on unexpected branch or main movement.
- Do not merge before exact-head verification.

## Next action
Complete full verification and review results before merging.
