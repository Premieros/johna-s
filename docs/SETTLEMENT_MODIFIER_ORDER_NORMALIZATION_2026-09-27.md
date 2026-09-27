# SETTLEMENT MODIFIER ORDER NORMALIZATION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/settlement-modifier-order-normalization-20260927`
Current PR: `#390`
Base: `main@27b89bad891187b4447e7a8ec214c25439c5dc01`
Last updated: 2026-09-27 Africa/Cairo

## Work status

State: **BLOCKED**

Progress: Root cause confirmed; forward-only repair and regression coverage implemented; exact-head Full Verify Green on implementation head.

## Guardrails

- This file is the mandatory execution log.
- Do not rely on conversation memory.
- Before every write, fetch branch HEAD and require the expected SHA.
- Unexpected HEAD => STOP_AND_RECONCILE.
- No direct write to `main`; no force push.
- No Production migration before exact-head Full Verify Green + explicit approval.
- Do not touch printing, Print Agent, routing, KDS behavior, or unrelated settlement/accounting logic.
- Preserve Permission-First, branch isolation, RLS, and existing settlement atomicity.
- No data rewrite of Table 42 or order Johna's-01119.

## Baseline

- Smouha branch: `19c3fd23-d784-455b-8840-f4f2ac619651`.
- Table 42 id: `bb3f47d9-05bc-404f-a054-8185bf87b97a`.
- Order: `Johna's-01119` / `3922f657-a1e4-4bf8-b5df-cf81fce6d0ee`.
- Order state: `open / unpaid`, total 1670.00.
- No sale exists for the order.
- One line has modifier IDs stored in one order while the snapshot presents the same IDs in the opposite order.

## Root-cause ledger

- Production `public._prepare_kitchen_sale_settlement` canonicalizes modifier IDs only in `v_payload_shape`.
- Production `v_preview_shape` keeps modifier IDs in incoming array order.
- Equal modifier sets with different ordering therefore compare as different JSON shapes and return `ORDER_ITEMS_MISMATCH`.
- The repository already contains the corrected historical migration `20260917094500_normalize_sent_only_modifier_order.sql`, which canonicalizes both preview and payload.
- Production migration history does NOT contain that migration, proving schema drift / unapplied normalization.
- Normal and split payment share this settlement-preparation boundary, so both paths are affected.

## Change ledger

- Development branch created from current main.
- Production diagnosis was read-only.
- No Production write.
- Added forward-only migration `20260927133500_reassert_settlement_modifier_order_normalization.sql`.
- Added integration regression coverage proving preview and payload canonicalize modifier IDs identically.
- Regression locks normal and split payment to the same settlement-preparation boundary.
- No application code change; no Production write.

## Verification ledger

- Production data check: confirmed.
- Production function-definition check: confirmed.
- Production migration-history check: confirmed missing normalization migration.
- Fast Verify #985: Green — canonical migrations, schema, and changed integration test all passed.
- Full Verify #3088 / run `36322863565` on `ce2a7100f0b7008091c9e7cb02e54489ffa3c2eb`: Green — worklog, Supabase identity, API contract, lint, typecheck, unit, build, DB/schema, integration + security/RLS, and browser-smoke all passed.

## Production gate

State: **BLOCKED**

No Production migration is authorized yet.

## Next action

1. Re-run exact-head Verify for this documentation commit.
2. Reconfirm latest `main` and PR mergeability.
3. Stop before applying the migration to Production and request explicit approval.

## Mandatory update protocol

- Verify branch HEAD before every write.
- Update Change ledger after each logical implementation group.
- Update Verification ledger after every test/CI run with actual results.
- Keep `docs/CURRENT_WORK_PLAN.md` pointing to this file while this workstream is active.
- No Production migration or merge until exact-head Full Verify Green and explicit approval.
