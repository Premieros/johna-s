# Opening FIFO cost repair follow-up — 2026-09-24

## Scope
- Repository: Premieros/johna-s
- Base: main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da
- Branch: development/opening-fifo-transfer-followup-20260924
- Production: azzdesuowpdcoflmyezn
- Printing/agents/routing: frozen and untouched.
- Production migration/backfill: not applied pending Full Verify Green + explicit approval.

## Confirmed blocker
Smouha opening-cost repair prepares 140 eligible zero-cost opening batches but historical FIFO replay stops on one changed reference:
- inventory_ledger.id = 19086
- reference_type = warehouse_transfer
- transfer = Johna's-00002
- source raw = اعشاب عدد 1 باكت
- source branch = Smouha
- destination branch = Cleopatra
- source and destination transfer valuation are both zero.
- destination transfer lot has no downstream consumption at inspection time.

## Fix
- Add guarded warehouse-transfer valuation propagation to the existing FIFO reference dispatcher.
- Update the exact destination positive transfer ledger row, matching destination batch cost, transfer-item unit cost, and destination avg-cost cache.
- Never alter stock quantities.
- Fail closed when destination identity is ambiguous or downstream consumption already exists.
- Add warehouse_transfer to the historical FIFO supported-reference guard.
- Preserve all existing sale/kitchen/production/purchase-return behavior by basing the overrides on the current Production function definitions.

## Safety
- No Production write.
- No automatic repair call in the migration.
- No printing code touched.
- Full Verify must be Green before Production approval is requested.
