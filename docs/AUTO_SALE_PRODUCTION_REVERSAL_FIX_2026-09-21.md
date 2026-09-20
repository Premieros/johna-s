# AUTO_SALE_PRODUCTION Reversal Fix — 2026-09-21

## Identity
- Repository: Premieros/johna-s
- Branch: development/auto-production-reversal-fix
- Base: main @ a1597857be2666efa65ec628f31801dedb2f9e4e
- PR: #281

## Problem
A POS sale/order can auto-produce a manufactured inventory unit when the unit is short.
The production consumes raw materials and may create negative raw-material debt.
Before this fix, void/refund restored the manufactured unit itself instead of reversing the exact AUTO_SALE_PRODUCTION source back through its raw/component inputs.

## Required behavior
- Pre-existing manufactured stock -> return as manufactured stock.
- AUTO_SALE_PRODUCTION created for the same sale/order -> reverse to the exact production inputs.
- Nested manufactured components -> reverse recursively to the original source.
- Partial void/refund -> idempotent; never restore the same source twice.
- Legacy rows without provenance -> preserve prior fallback behavior.

## Implementation
- Added exact source snapshots for kitchen-settled sale items and direct-sale unit entries.
- Added internal reversal ledgers for consumed unit entries and AUTO_SALE_PRODUCTION quantities.
- Added recursive source-reversal helpers.
- Patched kitchen void and refund inventory restoration to use exact source provenance.
- Added unit and integration coverage.

## Safety boundaries
- No printing code changed.
- No permission/RLS weakening.
- No Production migration applied while this PR is under verification.
- No changes to purchases, accounting policy, branch access, or printer routing.

## Verification
Pending GitHub Verify main / Fresh DB / integration checks.
