# Mobile Delivery App — implementation plan

## Scope

Build an Android-first mobile experience for two surfaces:

- Customer: browse branch catalog, configure items, cart, address, submit order, track order.
- Captain: view assigned delivery orders, accept, pick up, mark out-for-delivery, complete delivery.

The mobile UI is intentionally different from the POS UI. It must look and behave like a delivery application while reusing the canonical POS/ERP business rules.

## Fixed project identity

- Repository: `Premieros/johna-s`
- Production branch: `main`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Mobile branch: `development/mobile-delivery-app`
- Printing is frozen and out of scope.
- No direct changes to `main`.
- No Production migration before Full Verify Green and explicit approval.

## Proven reusable backend surface

Production already contains the canonical entities required for the first mobile integration: `branches`, `branch_settings`, `products`, `customers`, `orders`, and `order_items`. `orders.service_details` can carry service-specific metadata while the delivery schema is being finalized.

The mobile implementation must not create a parallel order engine. The existing order lifecycle, pricing, modifiers, branch isolation, payment state, kitchen state, and inventory authority remain canonical.

## Security boundary

The public Android client must never contain a `service_role` key or any privileged secret. Mobile operations will go through a deliberately narrow gateway/RPC surface with explicit branch/ownership checks and RLS-compatible authorization.

Customer identity must not be implemented by weakening the employee/user authorization model. Captain actions remain Permission-First and branch-scoped.

## Planned gateway contract

1. `get_mobile_catalog(branch_id)`
2. `create_customer_order(payload)`
3. `get_customer_order_status(order_id, access_token)`
4. `get_captain_orders()`
5. `accept_delivery_order(order_id)`
6. `update_delivery_status(order_id, status)`

Names are provisional until the repository's existing RPC/API patterns are fully matched. Any database addition will be append-only and covered by regression tests before Production.

## Delivery data additions expected

The existing schema has customer address text but no dedicated delivery assignment model. The likely minimal extension is an append-only delivery record linked to `orders`, containing:

- order_id
- branch_id
- assigned_captain_id
- delivery address snapshot
- latitude / longitude (optional)
- delivery fee
- delivery status
- accepted / picked_up / delivered timestamps
- collection/payment notes

This is not approved for Production yet; it is the target schema for a later migration after tests and explicit approval.

## Build phases

### Phase 1 — completed foundation

- Create isolated Expo/React Native workspace under `mobile/`.
- Add customer/captain entry experience.
- Define typed gateway contracts.
- Keep Production untouched.

### Phase 2 — customer MVP

- Branch selector.
- Catalog/categories/products from canonical backend.
- Product modifiers.
- Cart and totals.
- Customer/contact/address capture.
- Safe order submission.
- Order tracking.

### Phase 3 — captain MVP

- Employee sign-in using existing auth boundary.
- Permission check for delivery actions.
- Assigned/new delivery queue.
- Accept/pickup/out-for-delivery/delivered transitions.
- Cash collection state without bypassing canonical payment logic.

### Phase 4 — integration

- POS receives mobile orders in the same order domain.
- `send_to_kitchen` remains the inventory authority.
- Existing printer routing is reused unchanged.
- Realtime/push notifications are added after the order contract is stable.

### Phase 5 — verification and release

- Mobile typecheck/build.
- Repository lint/typecheck/unit/build.
- Fresh DB + schema + integration/security/RLS.
- Android smoke tests for customer and captain flows.
- Draft PR review.
- No merge without explicit approval.
- No Production migration without separate explicit approval.
