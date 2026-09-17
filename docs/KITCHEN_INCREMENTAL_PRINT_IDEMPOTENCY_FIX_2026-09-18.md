# Incremental Kitchen Print Idempotency Fix — 2026-09-18

## Base
- `main@42bd19d6e51578f69c29def30b3cb2e9257125bd`
- Branch: `development/kitchen-incremental-idempotency-fix`

## Defect
`order_kitchen_sends.id` remains stable for the same order item across incremental sends. Cloud kitchen printing used only that send id in the idempotency key, while Production enforces `UNIQUE(branch_id, idempotency_key)`. A later delta for the same line could therefore resolve to the already-submitted print job instead of creating a new job.

## Fix
- Expose RPC-returned `current_quantity` on `KitchenSendItem`.
- Build each delta identity as `send_id:current_quantity`.
- Retry of the same delta => same key.
- New incremental delta => different key.
- Multi-item station identities are sorted before building the station key.
- Deterministic fallback remains for legacy payloads without `current_quantity`.

## Safety
- No migration.
- No Production DB change.
- No RLS/permission change.
- `send_to_kitchen` remains authoritative for inventory deduction.
