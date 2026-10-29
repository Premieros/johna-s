# Cost ratio and receiving-branch raw transfer valuation
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/cost-ratio-destination-transfer-20261029`
Current PR: #547
Last updated: 2026-10-29

## Work status
State: **BLOCKED**
Owner authorizes preparation of cost percentage and receiving-branch transfer pricing. Production release not yet authorized.

## Guardrails
Single active writer. No production stock/order/print tests, replay, historical repricing or migrations during preparation. No new SECURITY DEFINER function or role/ACL changes. Preserve all quantity/identity/operator guards, source cost depletion, product transfers, same-branch moves, installed printers and online-primary architecture. No sales-path reads or writes added.

## Baseline
Main dcda01d961ad16d0006f9ed1dd8543562ad4809a, tree8fe493807c7440cbdd2b26298b146439ae961a91. Existing #545/#546 remain released. Scoped production metadata reads only; no logs scan.

## Root-cause ledger
Current approval removes source raw stock at its existing cost and passes that cost to the receiving raw stock. Client preview reads source warehouse average and is editable. Transfer unit_cost stores only2 decimals despite canonical6-decimal raw prices. Historical source-cost propagation can later alter a receipt; that must not override an independently priced receiving receipt. Current approved-price projection already resolves branch-specific purchase, stock-count, pricing and initial catalogue prices; missing price yields zero. Product editor/overview/recipe report omit the cost percentage while using the same underlying data for margin.

## Change ledger
Cost ratio = same cost / same positive sale value ×100. Product recipe panel, costing overview/invoice analysis and recipe report/export add the percentage beside margin without new queries. Incomplete recipe or zero/nonpositive denominator shows dash.
Interbranch raw preview uses existing get_raw_material_current_prices for resolved receiving IDs; branch changes batch selected items, fence stale responses and block failed reads. Preview is read-only and explicitly refreshed/fixed at approval; no arbitrary client unit cost. Server creation quotes destination latest price in one batch. Approval rechecks latest once in a batch, stores private per-line receipt price/source/time, updates transfer line, then calls unchanged raw stock movement with this exact receiver cost. Missing price=0, never fallback to sender/client. Source outbound costing stays unchanged; source and receiver valuation can differ by design. Same-branch raw/product paths unchanged.
Widen warehouse_transfer_items.unit_cost to numeric18,6. Private RLS receipt audit, no anon/authenticated access. Existing source-correction helper skips receipts carrying the new private frozen proof; historical pre-migration transfer correction logic unchanged. Transfer receipts are not registered as new published price events. Existing pending transfers adopt the rule when approved after release; approved historical transfers are not rewritten.

## Verification ledger
21 focused UI/read/worklog checks passed; app/test typechecks, build and changed-source lint passed. Canonical API contract remains171RPC/56public tables; the numeric precision widening does not change its type signature. Isolated integration covers receiver vs source/client, approval-time price change, zero missing receiver price, exact6-decimal storage/receipt, repeated approval, no source repair propagation, failure atomicity/privacy and rollback/reapply metadata. Required exact-head four-job CI before release. No production order/stock/print test.

## Production gate
لا Merge ولا Production migration before owner approval of this concrete candidate after exact-head verification. Preflight original function/security fingerprints and table metadata before apply. Atomic DDL lock_timeout2s/statement_timeout15s. Rollback script restores three function bodies; intentionally retains private audit rows and widened precision so approved history and fractional unit prices are never lost. Frontend rollback reverts candidate.

## Next action
Finish focused checks and isolated DB proof, publish one candidate, require final exact-head CI then request release approval.

## Mandatory update protocol
Keep unified plan/worklog and PR ledger current when scope/checks/head change. Preserve reviewed exact-tree fences and one sequential writer. Do not count skipped integration checks as passed.
