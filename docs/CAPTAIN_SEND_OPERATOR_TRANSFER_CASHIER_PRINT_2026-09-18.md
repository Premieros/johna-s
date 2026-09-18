# Captain Send + Operator Transfer + Cashier Print — 2026-09-18

## Base
- Repository: `Premieros/johna-s`
- Base main: `b6596cf352d085080753413ac2c86a4335491039`
- Branch: `development/captain-send-operator-transfer-cashier-print`

## Captain send
Production inspection confirmed the `cap` permission set already contains:
- `pos.send_kitchen`
- `pos.order.create`
- `pos.order.edit`
- `pos.receipt.print`

Recent Production captain orders also contain authoritative `order_kitchen_sends`, so the DB send boundary is working for own orders.

The repair preserves ownership:
- own order + `pos.send_kitchen` => send allowed;
- another operator's order => `ORDER_OPERATOR_REQUIRED`;
- the POS now explains that the operator must be transferred before retrying.

No role name is used for authorization.

## Operator transfer
- Existing `transfer_order_operator` remains the write boundary.
- `pos.order.transfer` is the complete action permission for operator transfer.
- `users.manage` is no longer required for this specific action.
- Branch, order-state, source-user and target-user validation remain enforced.
- The canonical cashier-assignment trigger continues to produce the audit record.
- The POS transfer dialog now lists eligible active branch users and allows ownership transfer.
- POS data refreshes immediately after transfer.

## Sale attribution after transfer
For a linked order:
- `sales.cashier_id` = current order owner at settlement time.
- `sales.salesperson_id` = current order owner at settlement time.
- `shift_operations.created_by` remains the authenticated user who actually executed payment.

Direct/unlinked sales remain attributed to the authenticated seller.
The internal `_process_sale_core` is not executable by authenticated/anon clients.

## POS print button
Open checks:
- are persisted first;
- require `pos.receipt.print`;
- require branch access + order ownership;
- enqueue `cloud_print_jobs.kind='receipt'`;
- always use `station_code='cashier'`.

Paid receipts retain the existing authorized receipt-print path, which already routes cloud/local receipt printing through the cashier/receipt route.

## Safety
- No RLS weakening.
- No role-name authorization.
- No cross-user kitchen-send bypass.
- No automatic permission grant to the `cap` role.
- No Production migration applied yet.
