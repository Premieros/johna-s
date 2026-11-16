# Online order markup — Premier — 2026-11-16

Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

Active branch: `feat/branch-online-order-markup-20261116`
Baseline main: `c8d5bbe6c78e989434660ddccc41162307cfd38d`
User scope: implement fifth POS category `online` analogous to `delivery`; configurable branch-local markup (26% default for enabled branch), existing branch tax; no edits to original product sale_price and no double markup for external integrations.

## Invariants
1. Online pricing is authoritative on server for staged orders AND final sales; preserve modifier price, discount, bonus, cost, tax, kitchen print, stock, accounting and refunds.
2. No existing branch automatically opted in. No production business writes or blanket backfill.
3. A branch's online pricing setting and privilege are not cross-branch writable.
4. Existing order types' prices must stay untouched.
5. External API imports require separate authenticated, idempotent, price-snapshot integration, not implicit acceptance of untrusted supplied prices.
6. No production deployment without exact-head Full Verify Green and production preflight.

## Current evidence
- POS order types: dine_in/takeaway/delivery/drive_thru. Order picker and OrderStartWizard render direct delivery flow.
- Current `public._pos_order_type_allowed` hard-codes the four types and per-type permission `pos.order.<type>`.
- `public._reprice_order_item` is a SECURITY DEFINER authoritative trigger: product base sale_price + validated modifier delta, then line discount, preserving special partial-transfer context.
- `public._sync_order_totals_from_items` derives subtotal then uses `public._effective_branch_tax`. Existing branch tax logic should remain unmodified.
- Existing sale writers also check prices on server; integration must avoid introducing a pathway to sell at an arbitrary client-chosen price.
- One branch local-first workstream #638 is paused.

## Delivery
- Initial code + migration, tests candidate in this PR.
- Explicitly list any deferred integration or incomplete parity; don't claim production deployment before verified.

## Candidate implementation staged
- `20261116171000_branch_online_pricing_foundation.sql`: one branch-local opt-in row, 0–100% increase setting default 26%, permission-guarded settings RPC, immutable base product prices, server helper. Existing delivery capability authorizes online order initiation; settings.manage gates configuration.
- `20261116171500_online_order_markup_snapshot.sql`: frozen order percentage in new nullable `orders.online_markup_percent`, no backfill and no change to existing order rows.
- `20261116172000_online_authoritative_pos_pricing.sql`: guarded replacements for the current modifier-aware item repricer, core sale item accounting, single and split checkout previews, with linked-order type mismatch guard. Existing tax function unchanged.
- UI: online order labels/type and POS button disabled until branch activation; settings tab and permission-scoped editor; price preview for cart, modifier options and branch tax; frozen live order markup preview.
- `tests/integration/branch_online_order_markup.test.ts`: localhost transaction/rollback test for tax, branch settings, 26% vs old, frozen 26% when new policy 40%, cross-branch RLS and non-opted-in branch failure.

## Important scope boundary
This feature is an additional manually operated Premier POS order type, not an external app API integration. No provider webhook or external payment settlement, no menu publication, no automatic imported order. For later platform integrations, use verified provider signatures, immutable inbound amount, idempotency and a separate settlement ledger; never apply the markup twice.
No branch automatically activated or percentage changed in production; target branch was not identified. Full Verify and actual production release are still pending.

## QA repair after first complete CI cycle
Run 43887494816: frontend/typecheck/lint and browser sections passed, but two unit cases correctly rejected reuse of delivery permission for online. New `pos.order.online` added to canonical Permission type, label, dependency contract, UI gate and `_pos_order_type_allowed`. This keeps each order type isolated (no silent broadening of delivery).
DB run failed two scenarios because the canonical fresh DB still has `orders_order_type_check` for the four old types. Forward-only migration `20261116171200_online_order_type_constraint.sql` extends that check; no existing row changed.
CI must be rerun at exact new HEAD. Nothing merged, production unchanged.

## Green CI, final helper grant hardening
Run `43888752444` at `80a0e05ea1b9e0c16ded8f765240863fbb81885b` completed FULL VERIFY GREEN: scope, DB 1295 passed/1 skipped, verify, both browser shards, pages continuity and browser smoke all succeeded. Final security review found internal SECURITY DEFINER price helper RPCs unnecessarily granted directly to `authenticated`. Appended forward-only migration `20261116172500_internal_online_price_execute_grants.sql` revoking these direct RPC EXECUTE grants; privileged POS writers and triggers continue to call them as function owner. Must obtain fresh exact-head CI before release. Do not auto-opt-in any branch.
