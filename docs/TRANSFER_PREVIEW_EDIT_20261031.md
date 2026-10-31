# Transfer source balance + editable approval preview — 2026-10-31
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/transfer-live-balance-approval-preview-20261031`
Current PR: #555
Last updated: 2026-10-31
State: **BLOCKED**

## Work status
The transfer balance and preview-edit feature is staged in PR #555 as draft; it is not deployed.

## Guardrails
Preserve FIFO, negative stock policy, authorizations and accounting; no production data writes.

## Baseline
Based on main@003ae83efda16cfd6184d4b8fc53d0b0a94fb2f0 and existing transfer/stock views.

## Root-cause ledger
The current transfer page lacks source-stock values, editable pending lines, and atomic review confirmation. The inventory page uses the raw-material warehouse balance view.

## Requested workflow
In creation display live per-warehouse stock of each source raw material, including negative balances, matching the inventory screen. Before approval present a preview listing all transfer lines, source stock, and quantity editing/deletion. Save edits to a PENDING transfer only; reviewed immutable snapshot must be checked inside approval transaction. Never block transfers due to negative stock in the UI.

## Verified source of truth
`RawMaterialBranchStockPanel` uses `public.raw_material_warehouse_inventory` filtered by branch/warehouse/raw material. The new read service selects the exact same view/keys, with no local recomputation or quantities inferred from pricing. Supabase RLS permits read for `warehouse_transfer_items` through its parent; direct writes are RPC-only. Review is separate from the negative FIFO transfer policy staged in PR #554.

## Change ledger

### Implementation
- New `transferPreviewData.ts`: canonical live balance read and transfer item read, both fail closed on network/invalid numbers.
- TransfersPage displays live available quantity beside raw lines and in approval modal, allows editing/deleting pending raw lines, requires saving edits before approval, and refreshes preview on demand.
- `revise_pending_warehouse_transfer` locks transfer header and lines, checks approve permission and both branch access rights, rejects stale snapshots, validates IDs, quantities and duplicates before atomic changes, rejects approved/rejected changes and empty transfers.
- `approve_previewed_warehouse_transfer` locks the same transfer header and verifies exact preview of all item identities, source/destination raw IDs, product IDs and quantities in same transaction before calling the existing authorization/FIFO/COGS approval writer. Failure or changed snapshot does not automatically retry.
- Legacy non-raw transfer lines remain preview-only; product transfer posting behavior unchanged.
- Negative balances displayed as negative without rejecting the request.

## Verification ledger
Read-only SQL verified source inventory view, RLS policy and constraints. Disposable DB test added for saving quantity/removing item, stale/duplicate edit rejection, no inventory ledger writes and immutable approved status. Full exact-head CI and transactional integration are pending.

## Production gate
State: **BLOCKED**. Require exact-head full CI, security/RLS tests, and explicit approval before merge or production migration.

## Safety
No modification of inventory, batches, COGS, journals, purchases, sales or prior approved transfers in this migration; no production SQL executed. Security-definer functions explicitly check auth.uid, inventory.transfer.approve and source+destination branches, and revoke public/anon EXECUTE. Concurrency is protected by row-level locks. Keep the release BLOCKED until verification and independent approval.

## Dependency
This UI work does not change the legacy approval rule on negative raw stock. PR #554 addresses that separately; do not promise transfers below zero will approve until it has passed safety tests and is released.

## Next action
Run latest CI and review results including typecheck, unit tests, and atomic pending-transfer database tests; correct any failures.

## Mandatory update protocol
Update this worklog after every verification and release action. لا Merge ولا Production migration without tests and explicit approval. 
