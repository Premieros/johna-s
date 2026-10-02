# PAID ORDER REOPEN GUARD — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/paid-order-reopen-guard-20261002`
Current PR: `#0`
Last updated: 2026-10-02

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to `main`.
- No force push.
- Production incident correction is limited to the already-approved single order `101c3b2f-74f4-4904-828f-5f8fbff9627c`; that targeted repair has been completed and audited.
- No Production migration from this track without a second explicit approval after exact-head Full Verify Green.
- Preserve Permission-First, branch isolation, RLS, accounting, FIFO, KDS routing, printing, payments, and shifts.
- A settled/paid kitchen quantity must never be mutated by the sent-item Void path; financial reversal belongs to Refund.
- Sent-only settlement remains supported, but the UI must not represent a partial settlement as a closed order.
- Runtime changes must remain safe for active Cleopatra and Smouha branches.

## Baseline
- Branch created from `main@03efc4ccf154529cd584db20d91d231f4e30ebcc`.
- Production incident: Cleopatra order `Johna's-01756` / id `101c3b2f-74f4-4904-828f-5f8fbff9627c`.
- Linked completed sale: `Johna's-01867` / id `3299748e-4d16-4b20-bb2a-a0adf373b1e9`, total 62.70, paid 62.70.
- The order remained open/partial after sent-only settlement, then a settled sent item was voided, and a later item was sent/voided on the same order.
- Read-only seven-day scan: Cleopatra 1 open linked-sale shell out of 564 linked sales; Smouha 0 out of 305.
- Targeted Production repair closed only this stale shell as completed/paid; no sale, journal, inventory, or payment amount was rewritten.

## Root-cause ledger
- `process_sale` intentionally supports sent-only settlement and returns `order_completed=false` when unsent/unsettled quantity remains.
- The POS wrapper correctly receives `order_completed`, but still creates a receipt and the receipt modal always renders the generic `saleCompleted` heading, which can make a partial settlement look like a closed order.
- `cancel_sent_order_item_exact` calls `_restore_kitchen_inventory_for_void`. That helper restores only unsettled kitchen events, but currently returns success even when the requested quantity is locked to a settled sale; the caller can then delete/reduce the paid order item.
- The existing fully-voided auto-close path closes only unpaid/no-payment orders, so a paid partial shell can remain open after the last unresolved addition is removed.

## Change ledger
- Production incident repaired with a guarded one-row status/payment-state correction and an audit_log record.
- No application or schema hotfix has been merged or deployed yet.
- Planned forward-only migration:
  1. preflight settled-vs-unsettled quantity before any kitchen-void inventory mutation;
  2. reject attempts that reach financially settled quantity with `PAID_ITEM_REFUND_REQUIRED`;
  3. reconcile an open paid order after a successful kitchen void when no unsent/unsettled quantity remains.
- Planned UI hardening:
  1. warn before checkout when `unsent_quantity > 0`;
  2. show partial-settlement receipt state distinctly from completed-order state;
  3. change the post-payment partial message from success to warning.

## Verification ledger
- Production incident read-only reconstruction: complete.
- Targeted Production incident repair: complete.
- Migration implementation: pending.
- UI implementation: pending.
- Integration regression: pending.
- Unit/UI regression: pending.
- Exact-head Full Verify: pending.
- Production migration: not applied.

## Production gate
State: **BLOCKED**
- The current approval covers the single-order incident repair and preparation/testing of the hotfix.
- Applying the hotfix migration to Production requires a new explicit approval after Green verification.

## Next action
1. Add the forward-only migration and UI containment.
2. Add regressions reproducing paid-item Void and paid-open-shell behavior.
3. Open a Draft PR.
4. Run exact-head Full Verify.
5. Present SQL scope, impact, rollback, and Green evidence for explicit Production approval.

## Mandatory update protocol
- Before every repository write, verify expected branch HEAD and latest `main`.
- Unexpected HEAD/divergence => stop and reconcile.
- Record code/test/CI results in this log.
- No force push.
- No merge or Production migration until exact-head Full Verify is Green and explicit approval is obtained.
