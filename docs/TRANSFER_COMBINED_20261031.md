# Combined warehouse transfer negative FIFO + preapproval review
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `integrate/transfer-negative-preview-20261031`
Current PR: #556
Last updated: 2026-10-31
State: **BLOCKED**

## Work status
Integrate #554 (source negative FIFO raw warehouse transfers) and #555 (inventory-matched raw balances; review, edit and delete pending items). One combined release candidate is staged. Historical transfers remain untouched.

## Guardrails
Production is READ-ONLY during investigation and validation. No transfer/stock/count/sale/payment or journal processing against live data as a test. No direct SQL DML on business data. Preserve ledger FIFO debts, receipt-cost basis and permissions. Product transfers must remain strict nonnegative.

## Baseline
Main `003ae83efda16cfd6184d4b8fc53d0b0a94fb2f0`; integrated branch starts from #554 exact commit `db76d3f87589897ae6b849e4901ea7b672bb564a` plus #555 changes. Source inventory page: `public.raw_material_warehouse_inventory` scoped to branch and warehouse.

## Root-cause ledger
1. Live approval RPC rejected raw transfers when source availability was below requested quantity and executed FIFO with default `p_allow_negative=false`; source inventory may legitimately go negative.
2. Initial source stock panel showed a per-warehouse amount; transfer create/approve page had no matching balance display.
3. Prior transfer approval from list had no review or safe editing, creating risk of approving unintended line quantities.
4. Real FIFO debt settlement/performance on a heavily negative receiving warehouse needs disposable DB proof and must not be inferred from green smoke alone.

## Change ledger
- Forward migration `20261031205500_transfer_allow_negative_raw_fifo.sql`: remove strict raw shortage preflight and call canonical warehouse-aware FIFO removal with `allow_negative=true`. Preserve product shortage check and destination price snapshot.
- Forward migration `20261031222000_revise_pending_warehouse_transfer.sql`: transactional revisions for pending raw items and approval against immutable reviewed snapshot. Enforce permissions, both branch scopes, status checks, row locks and no duplicate/stale edits.
- UI uses the same canonical source warehouse view as Inventory page to show current stock including negative quantity; pending approval dialog edits/removes rows and separately saves them before approve. Approval re-reads stock, warns if changed and requires reviewing before proceeding. The client also writes best-effort edit audit telemetry without making committed changes appear failed. Product lines preview only.
- Drop obsolete create-preflight candidate and static test that would have rejected negative source inventory.
- Supabase frontend contract updated.

## Verification ledger
Individual PRs #554 and #555 reached green four-job CI (#4537 and #4542). Integrated #4545 verified three of four new real FIFO/approval integration cases, including negative source and cross-branch receiver debt settlement; the fourth failed solely because the synthetic baseline already contains two unbalanced test journal entries and the test assumed zero. Corrected it to compare accounting to its exact before-state. Added a separate future source positive receipt/FIFO cost-propagation test, plus coordinated function-only rollback script. Exact-head combined full CI with these changes is pending. No production data was touched.

## Production gate
State: **BLOCKED** until combined exact-head 4-job CI green, demonstrated negative FIFO transfer plus preview-edit in disposable database including valuation and idempotency, source/destination permission checks, no unexpected accounting effects and explicit final merge/deployment authorization. Do not mutate live stock to verify.

## Next action
Inspect latest exact-head 4-job CI including negative FIFO issuance, later cost settlement, cross-branch receiving debt, pending edits and no accounting changes. Keep the two earlier drafts pending until one combined release is verified.

## Mandatory update protocol
Track every change and verification here. السجل هو المرجع الإجباري للعمل. CI يجب أن يفشل if this record is missing or incomplete. لا Merge ولا Production migration without release checks and permission.
