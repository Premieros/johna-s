# Catalog 6A API contract parity fix

Date: 2026-09-12

- Production migration `catalog_create_contract` was applied to the only Production Supabase project `azzdesuowpdcoflmyezn` after explicit approval and post-merge Verify #1210 Full Green.
- Production contains both guarded 6A RPCs: `create_product` and `create_raw_material`.
- Deploy #617 exposed a contract-generation regression: `supabase/api-contract.json` inherited the preceding `replaceProductUnits` parameters for both new wrappers because `scripts/db/gen-contract.js` only understood inline `p: { ... }` parameter types and not named local type aliases.
- This corrective scope changes only the contract generator, the generated API contract, and regression coverage. It does not change SQL, RLS, application behavior, or start 6B/6C/6D.
- Required closure: focused tests + Full Verify + Production parity + deploy. No additional Production migration is required for this correction.
