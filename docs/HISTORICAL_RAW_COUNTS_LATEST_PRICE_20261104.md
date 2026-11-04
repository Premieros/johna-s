# Historical raw stock counts at latest published price

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `experiment/historical-count-quantity-offset`
Current PR: #597
Last updated: 2026-11-04
State: **BLOCKED**

## Work status
Implementation and rollback package complete. Exact-head CI and final production preflight pending. User has authorized merge, application and both November counts. This entry supersedes earlier candidate-only restrictions for this specific release once verification passes.

## Guardrails
Raw-only counts use the existing permission and branch checks. Product/mixed counts retain their previous implementation. Sales, kitchen and printing RPC bindings remain unchanged. No test data is written to production. No full-history scan is added to sale/kitchen requests. A busy stock lock returns promptly; the count cannot wait indefinitely behind a sale. Zero is the default valuation in the count projection of the existing canonical price reader.

## Baseline
Both November documents are draft: Johna's-00008 (407 raw lines) and Johna's-00009 (402 raw lines). All lines have physical quantities. Current source prices for these documents have at most two decimal places. There are 41 and 37 shortage corrections respectively after preserving later transactions. Function definitions were inspected directly and are guarded by exact hashes in the migration. Source readers for other screens are not changed.

## Root-cause ledger
The previous apply path compared physical quantities with today's stock, then used FIFO valuation or receipt debt replay. Historical count baselines can also differ from the originally stored snapshot. Open oversold positions prevented the unshipped last-price prototype from posting.

## Change ledger
- Raw-only dispatch to the historical count implementation behind existing authorization.
- Verified ledger cutoff at document creation; persist that baseline on the line.
- Separate effective movement time from latest price valuation time.
- Reconcile negative batch quantities against existing debt metadata before posting.
- Quantity-only offset of pre-count debts; preserve later negative activity and sale cost.
- Negative count corrections can remain negative after later sales, valued at published price.
- Later legacy receipts cannot reprice movements explicitly marked approved_last_known.
- Stock, offsets, line prices/status and balanced journal commit atomically.
- Refuse malformed lines, duplicate raw lines, orphan postings or a superseding applied count.
- Binding rollback preserves already posted stock/journals and audit columns.

## Verification ledger
50 integration checks passed across 8 files in disposable PostgreSQL. Includes real separate-connection stock locking, journal failure rollback, receipt after count deficit, retry, zero price and later sale preservation. Existing raw test openings now include ledger provenance. Draft Excel quoted prices do not override published prices when posting. Typecheck and changed test lint passed before final packaging; CI must validate the final commit. No production success is claimed yet.

## Production gate
Require exact-head Verify main success, final ledger/batch/debt reconciliation and no superseding count. Apply the guarded migration once. Post approved documents through the normal public RPC under an authorized account, in a transaction that fails if either response is unsuccessful. Verify stock totals, historical deltas, document status, journal balance and no duplicate references afterwards. Do not silently waive baseline or reconciliation errors.

## Next action
Push the complete release package, inspect exact-head CI, then merge and apply after successful checks. If preflight reveals unexplained stock provenance, repair only that coordinate with explicit evidence; never remove the reconciliation gate.

## Mandatory update protocol
Update this log after CI, merge, migration and count application. Record real results and remaining blockers. Never label local regression success as production application.
