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
- Reconcile negative batch quantities against existing debt metadata before posting, using the existing partial open-debt index (do not scan settled debt history).
- Quantity-only offset of pre-count debts; preserve later negative activity and sale cost.
- Negative count corrections can remain negative after later sales, valued at published price.
- Later legacy receipts cannot reprice movements explicitly marked approved_last_known.
- Stock, offsets, line prices/status and balanced journal commit atomically.
- Refuse malformed lines, duplicate raw lines, orphan postings or a superseding applied count.
- Binding rollback preserves already posted stock/journals and audit columns.

## Verification ledger
55 integration checks passed across 10 files in disposable PostgreSQL. Includes real separate-connection stock locking, journal failure rollback, receipt after count deficit, retry, zero price and later sale preservation. Existing raw test openings now include ledger provenance. Draft Excel quoted prices do not override published prices when posting. Typecheck and changed test lint passed before final packaging; CI must validate the final commit. No production success is claimed yet.

## Production gate
Require exact-head Verify main success, final ledger/batch/debt reconciliation and no superseding count. Apply the guarded migration once. Post approved documents through the normal public RPC under an authorized account, in a transaction that fails if either response is unsuccessful. Verify stock totals, historical deltas, document status, journal balance and no duplicate references afterwards. Do not silently waive baseline or reconciliation errors.

## Next action
Push the complete release package, inspect exact-head CI, then merge and apply after successful checks. A broad preflight query was canceled when slow; use bounded coordinate checks and the atomic in-function validation rather than repeating large scans. If preflight reveals unexplained stock provenance, repair only that coordinate with explicit evidence; never remove the reconciliation gate.

## Mandatory update protocol
Update this log after CI, merge, migration and count application. Record real results and remaining blockers. Never label local regression success as production application.

## Follow-up: batch-read correction
Branch: `fix/historical-count-batch-reads`, follow-up to merged #597.
The first migration is applied in production. The protected six-second Smouha
posting attempt timed out and rolled back; both documents remain draft with no
stock-count ledger or journal rows. Do not increase the execution deadline.

The follow-up snapshots prices and historical/current quantities once under the
same coordinate locks, then passes the frozen canonical price into private
movement helpers. Per-item stock/journal checks and debt validation remain. No
new source or table is introduced. Prior overloads are removed transactionally
to prevent ambiguous default arguments. A production-function checksum guard
prevents overwriting a drifted implementation.

Local 407-line negative-stock proof improved from 2433 ms to 1307 ms, with the
same zero final aggregate quantity and balanced 28490 debit/credit. Full targeted
regression and exact-head CI are required before this follow-up is applied.

## Follow-up: bounded legacy quantity housekeeping
Branch: `fix/count-bounded-legacy-cleanup`, follows merged #598.
The second protected attempt also rolled back at six seconds. Production contains
11135 open debt rows in Smouha and 9792 in Cleopatra, up to 3977/3441 for one raw
material. The first small fixture did not represent this per-material history.

Replace per-lot correlated validation with one grouped full join under stock
locks. Post the count's signed delta and balanced journal immediately, preserving
all net-stock checks. Quantity-only compatibility cleanup is separately resumable
from the existing count receipt ledger, at most 500 debt rows per call (a lower
transaction-local limit can be selected). No queue or alternate price source is
introduced. Applied count cutoffs prevent a concurrent later purchase from
repricing covered historical sales while cleanup runs.

59 targeted tests across 12 files pass, including a purchase before cleanup.
A 407-line /11135-debt local proof posts in 820 ms; subsequent bounded cleanup
finishes with unchanged zero stock, no pre-count open debt and unchanged balanced
115420 debit/credit. Largest individual cleanup call:488 ms. These are local
measurements, not production success. Existing deployed migrations remain intact;
the new guarded migration is 20261104072139_linear_count_debt_validation.sql.
