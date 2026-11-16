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
