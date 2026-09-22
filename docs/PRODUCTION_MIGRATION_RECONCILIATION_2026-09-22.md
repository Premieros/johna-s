# Production Migration Reconciliation — 2026-09-22

## Scope

Production: `azzdesuowpdcoflmyezn`

Reference: latest `main@0b002c58f6ddc361e81b73a3610a248d60f3ae1c` after rebuilding on the latest main following PRs #310 and #311.

The canonical Fresh DB sequence contains 404 migrations. Comparing both Production migration histories by exact/logical name produced 47 canonical files without a matching Production migration record.

A missing record is not automatically missing behavior. Each candidate was checked against the live Production schema/functions before any repair was created.

## Classification of the 47 unmatched canonical files

- **31** — already represented in the live schema or superseded by a later applied migration.
  Examples: warehouse default schema, manager approvals, nested manufacturing, granular product/inventory RLS, POS sellability, kitchen inventory boundary, shift close override, current auto-production negative-raw internal path.
- **11** — confirmed non-print behavioral gaps consolidated into the forward migration below.
- **4** — printing migrations intentionally frozen and **not applied**:
  - `20260911232000_cloud_print_agent.sql`
  - `20260911233000_cloud_print_ambiguous_outcome_guard.sql`
  - `20260912002000_cloud_print_submission_truth.sql`
  - `20260918231500_thermal_print_payload_guard.sql`
- **1** — `20260914153000_branch_scoped_kitchen_stations.sql`: core branch column/index and both branch-integrity guards are already live and current cross-branch link counts are zero. Only the new-branch seed trigger is absent. It is intentionally not changed in this reconciliation because station/routing behavior is adjacent to the frozen printing surface and there is no current existing-branch integrity defect.

Total: **47**.

## Confirmed gaps being reconciled

Migration:
`supabase/migrations/20260922110000_reconcile_unapplied_non_print_contracts.sql`

The forward-only reconciliation covers the final intended effects of these unmatched migrations without replaying stale migrations blindly:

1. `20260905001000_canonical_product_image_permission.sql` — granular branch-scoped product image storage policies.
2. `20260911133000_purchase_request_create_permission_alignment.sql` — `procurement.request.create` plus multi-branch branch guard.
3. `20260911194500_raw_material_stock_count_create.sql` — raw-material stock-count rows, corrected to read the selected warehouse balance.
4. `20260911194600_raw_material_stock_count_apply.sql` — raw-material stock-count application through warehouse-aware raw FIFO.
5. `20260913083000_purchase_receive_atomicity.sql` — receive preflight for required/branch-correct warehouse plus multi-branch guard.
6. `20260917083000_atomic_transfer_order_to_table.sql` — server-authoritative whole-order table transfer.
7. `20260917090000_harden_order_create_update_permissions.sql` — missing Permission-First create/edit/ownership/sent-line guards are patched into the **current live function bodies**, not replaced by the older whole functions.
8. `20260917093000_fix_pos_hardening_verify_regressions.sql` — operator-assignment and controlled sent-item error semantics included in the targeted live patches.
9. `20260917180500_user_role_guard_action_alignment.sql` — user INSERT uses `users.create`, UPDATE remains `users.manage`.
10. `20260917231500_kds_keep_paid_orders_until_served.sql` — paid/completed kitchen work remains visible until kitchen status is served; queue main-station fallback stays branch-scoped.
11. `20260921084500_cross_operator_partial_void_idempotent_sync.sql` — skip no-op send-snapshot UPDATE after controlled void.

## Important superseded examples

- `20260902010500_fix_pos_availability_cap.sql` is not replayed. Current POS uses the later applied `get_pos_product_sellability` / configuration validation path.
- `20260914010600_pos_auto_production_negative_raw.sql` is not replayed. Production already has the later hardened internal auto-production path from `20260914010700`, and `_ensure_inventory_unit_stock` calls the internal producer with negative raw allowed only for `AUTO_SALE_PRODUCTION`.
- Old kitchen-send/shift/permission migrations whose final effects are already present are not replayed.

## Safety

- No Print Agent change.
- No `cloud_print_jobs` change.
- No printer routing/payload/receipt migration.
- No direct sales/purchase/order/inventory quantity rewrite.
- Dynamic patches fail closed if the live function shape is unexpected.
- Production application is allowed only after exact-head Full Verify Green.
