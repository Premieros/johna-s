# Split Payment Order Status Repair — 2026-09-27

## Scope

Project: `Premieros/johna-s`

Branch: `development/fix-split-payment-status-20260927`

Production project: `azzdesuowpdcoflmyezn`

This repair is isolated to linked-order split-tender settlement state. Printing, Print Agent, printer routing, KDS, `send_to_kitchen`, inventory deduction semantics, permissions and RLS are frozen and not modified.

## Production evidence (read-only)

A post-merge audit found completed split-tender sales whose linked orders remained `payment_status='unpaid'`.

Last-24h sample at diagnosis:

- cash: 87 linked completed sales, all `orders.payment_status='paid'`;
- card: 41 linked completed sales, all `orders.payment_status='paid'`;
- credit: 3 linked completed sales, intentionally `unpaid` with zero paid amount;
- split: 5 linked completed sales totaling 10,749.00, all fully paid but their linked orders remained `unpaid`.

The affected split sales had correct `sale_payments`, correct paid amounts, and correctly linked `order_kitchen_inventory_events.settled_sale_id`. The fault was therefore isolated to order payment-state reconciliation, not sale creation, tender accounting, Kitchen settlement, or inventory consumption.

## Root cause

Normal `process_sale` performs a post-settlement reconciliation of linked-order `payment_status` after Kitchen inventory events are finalized.

`process_sale_split` intentionally delegates the physical sale/inventory write to `_process_sale_core`, finalizes Kitchen settlement, writes split tender metadata, and rewrites collection accounting. It did not perform the normal linked-order payment-state reconciliation afterward.

As a result, the sale and tender accounting were correct while `orders.payment_status` retained its pre-payment value.

## Repair

Migration:

`supabase/migrations/20260927203000_fix_split_order_payment_status.sql`

The migration patches only `process_sale_split` after its final split sale amount is written:

- recomputes paid/total from authoritative settled sale IDs;
- sets `paid` only when the linked order is completed and settled amounts cover settled totals;
- sets `partial` when payment exists but the order remains operationally incomplete;
- preserves `unpaid` when no settled payment exists;
- updates `payment_at` only when paid amount exists.

The migration also includes a deterministic historical repair for orders that have at least one completed split sale, using de-duplicated settled sale IDs as the payment source of truth.

## Regression coverage

`tests/integration/split_payment_atomicity.test.ts` now asserts that a Kitchen-sent linked order paid through split tender:

- succeeds;
- does not deduct inventory a second time;
- finishes with `orders.status='completed'`;
- finishes with `orders.payment_status='paid'`;
- has a non-null `payment_at`.

## Production guard

No Production migration or data write is authorized by this branch alone.

Required sequence:

1. focused/fresh DB verification;
2. exact-head Full Verify Green;
3. explicit user approval;
4. only then Production migration;
5. post-migration read-only reconciliation of split orders and branch health.

