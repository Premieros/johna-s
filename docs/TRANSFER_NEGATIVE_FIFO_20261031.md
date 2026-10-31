# Negative raw stock transfer support — 2026-10-31
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/negative-raw-stock-warehouse-transfer-20261031`
Current PR: #554
Last updated: 2026-10-31
State: **BLOCKED**

## Work status
Owner clarified that raw-material negative stock is permitted system-wide and must not block warehouse transfers. Previous blocking preflight migration was deleted from a separate unmerged branch before any deployment. This branch stages a database-only change to the actual approval procedure, while leaving creation behavior and installed production schema unchanged.

## Guardrails
Do not modify any existing business quantities, history, FIFO debt, sales, journals, payments, stock counts or user permissions. No forced real transfer. Never suppress errors from the canonical FIFO removal/addition or weaken cross-branch authorization and approval idempotency. Do not merge/deploy before full isolated tests and explicit production approval.

## Baseline
Main `003ae83efda16cfd6184d4b8fc53d0b0a94fb2f0`, prior PR #553 merged. Production DB function previously preflighted availability and called FIFO removal with default `p_allow_negative=false`.

## Root-cause ledger
Verified live procedure `approve_warehouse_transfer`: raw-material preflight returns `INSUFFICIENT_RAW_STOCK` for negative/short source and both raw removal call variants default to strict FIFO. Canonical warehouse-aware `_raw_remove_fifo(..., p_allow_negative=true)` can create `OV-*` batches, inventory ledger entries and `raw_fifo_debts` while maintaining advisory locks. Destination `_raw_add` settles receiver FIFO debts; `_fifo_adjust_reference_delta` supports `warehouse_transfer`. Product transfer path is not within this UI or change.

## Change ledger
A guarded forward-only migration removes the raw shortage preflight from the transfer approval RPC; retains item-unit/warehouse/branch/status checks; uses canonical warehouse-aware FIFO with `p_allow_negative=true` in both same-branch and cross-branch raw paths. Removes obsolete candidate SQL that would have forbidden creating short-stock transfers, and its obsolete test. No data update is performed by installing this migration.

## Verification ledger
Static regression contract tests and a read-only disposable PostgreSQL installed-function integration test added. A guarded function-only rollback is staged at `scripts/rollback/transfer_allow_negative_raw_fifo_20261031.sql`. Read-only production SQL confirmed each of the three exact migration replacement anchors occurs once (1/1/1). Full runtime FIFO/concurrency tests, latest exact-head CI, downstream FIFO cost settlement and closed accounting behavior are not yet verified. Migration remains release-blocked. Especially test source already negative, source partially available, destination negative debt, no double deduction, repeated approve, concurrent kitchen, future source debt settlement, and rollback.

## Production gate
State: **BLOCKED**
No Merge or Production migration before exact-head full Verify Green and explicit separate approval. Installation should only modify the stored approval function, without executing any transfers.

## Next action
Review function drift guards, test on disposable PostgreSQL, validate FIFO debt/cost outcomes, then run exact-head CI and independent release approval.

## Mandatory update protocol
Record changes, tests and release decisions here. السجل هو المرجع الإجباري للعمل. CI يجب أن يفشل for missing or wrong-branch worklog. لا Merge ولا Production migration until tests and separate production approval.
