# Customer receipt table and captain-count investigation
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/receipt-table-captain-counts-20261027`
Current PR: #543
Last updated: 2026-10-27

## Work status
State: **BLOCKED**
Preparation authorized. No production rollout approved for this candidate.

## Guardrails
No production operational writes or log scans. No schema, grants, RLS, attribution/core payment/transfer/KDS/printing queue algorithm or installed-agent changes. No receipt replay. Maintain current order captain attribution at settlement.

## Baseline
Main 79718c7b0435920bfdfc6c5f71135f1826374b64, same source tree as local 7ddcbe6. Production receipt template still renders table names when provided.

## Root-cause ledger
Confirmed Cleopatra open checks 05022 and 05061 lacked tables although saved orders belong to tables 46 and 27. Open check 05066 was printed with generated ORDER identity, takeaway type and raw product IDs although its persisted order is dine-in/table23. Resumed order metadata is hydrated separately: orderLoading clears before the independent table lookup completes, and the wrapper can print while order hydration is incomplete. Historical SalesPage receipt adapter also omits table/order metadata entirely.
Captain audit: owner clarifies 29 vs28 for Ali, another captain missing4; last-two-hours inspection requested. At 2026-10-26 21:58 UTC (00:58 Cairo),16 recent Cleopatra invoices were found:9 Ali Khaled,7 Ibrahim; all matched their saved order operator, none archived or unlinked to shift operations. One Ali invoice (Johna's-05304) has total zero and is included in the count; no automatic exclusion or data correction was made. Most recent complete shift has49 invoices:19 Ali,24 Ibrahim,5 Habiba,1 Zico; source counts agree with the queued thermal report. The stated29/28 discrepancy has not been reproduced. Never manufacture count corrections or alter assignment to payer.

## Change ledger
Hydrate table in the existing authorized order read; bind table metadata before declaring resume ready. Reject customer-check printing during order/table hydration and reject stale settlement preview. Restore persisted sale table and order number in SalesPage reprints. No new per-order round trips for the normal hydrated path. A metadata scope fence prevents a pending preview from printing an earlier table/cart. Remove the old active-order error fallback to a different previously paid receipt.

## Verification ledger
39 focused behavioral/contract tests passed, including resumed table hydration, table switching, deferred preview/order switching, same-order table changes, persisted sale table metadata and existing payment/discount/authorization contracts. App/test TypeScript passed; scoped lint has no errors. Mandatory exact-head CI pending.

## Production gate
No Merge ولا Production migration before separate approval. Frontend-only candidate; rollback by reverting the PR. Existing receipt/KDS/stock/sale core unchanged.

## Next action
Complete receipt repair, verify branch/order switching and exact printed metadata. Continue captain discrepancy audit only with bounded evidence; do not claim an unproven fix.

## Mandatory update protocol
Single writer. Capture exact-head results and approval/release evidence in PR ledger. Avoid documentation-only retests.
