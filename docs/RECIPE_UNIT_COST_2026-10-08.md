# Current recipe unit cost consistency
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/recipe-live-cost-20261008`
Current PR: #469
Last updated: 2026-10-08

## Work status
Implementation under verification. State: **BLOCKED** for production application.
## Guardrails
Single writer. Preserve RLS, permissions, Financial Visibility, sent items, stock, print, KDS, shifts and balanced accounting. User keeps old invoice values unchanged, but now explicitly authorizes correcting previous sale COSTS when supported by evidence. No invented prices.
## Baseline
05c77317f64ba35edd16465928144bf37d918a78. Discount #468 user approved and applied to production; postmerge Full Verify37752414581 and Pages37752414554 passed.
## Root-cause ledger
Product editor displays manual cost0 rather than a recipe unit estimate; old Recipes route is retired and redirects to Products. Costing Center includes all recipe versions without unit-yield division, and ignores nested component groups. Cleopatra has31 used raw materials with no known price; those require real prices, never fabricated costs.
## Change ledger
Read-only private SECURITY INVOKER raw-line helper flattens nested component groups, respects latest active direct recipe and direct recipe yield. Existing public costing RPCs retain access guards/ACL and use the same lines. Saved product costs in Products, Pricing and Costing Center read get_costing_overview through one service; ready products use actual positive batch cost then manual reference, manufactured products use their recipe. Unsaved product editor group estimates use their raw ingredients and latest raw prices, guard missing/empty/cyclic groups, and withhold cost/margin when incomplete. Product-linked group quantities remain per sale. No operational stock/printing/sale mutation changes.
## Verification ledger
Initial full unit run had one source-contract failure in the retired recipe page; that unrelated page change was removed after user clarified recipes are inside Products. Final targeted14 tests passed, application/test typechecks passed. Full unit/build/lint recheck and fresh-database full CI pending. Product cost displays use two decimals. Supabase CLI is not installed in this runtime; forward SQL migration uses the repository's established timestamped migration path and fresh-DB harness.
## Production gate
New production helper/function changes require separate explicit approval after exact-head Full Verify Green. No costing migration applied.
## Next action
Verify nested-group/yield/unknown-price coverage, open PR, finish exact-head CI, and request approval of concrete costing migration. Actual missing raw prices still need source data.
## Mandatory update protocol
Update this log with implementation/verification transitions. Reconcile unexpected head movement; no force push or direct main write.

Historical Cleopatra read audit from Oct1:1668 zero-cost raw consumption movements;1474 have a current reference price (estimated10233.93),194 still lack prices. These figures are reference estimates, not assumed purchase receipts. No historical cost write performed.

Full local suite exposed pricing hydration source-contract mismatch and repeated toast-handler dependency in product cost loading under smoke-test mocks. Updated dependency contract and stabilized cost-error notification reference; no repeated cost query on search/render. Reverification pending.
