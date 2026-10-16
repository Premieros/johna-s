# Installed-agent report and latest-price consumption repair

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/legacy-zreport-bounded-pages-20261017`
Current PR: #520
Last updated: 2026-10-17 Africa/Cairo
State: **BLOCKED**

## Guardrails
Owner explicitly retains installed Windows agent and requests latest approved raw prices for operational costs. No stop/install/upgrade, physical tests, history replay/edits, kitchen/bar/receipt/claim/start/complete changes, cashier activation, stock quantity/FIFO/accounting writer changes. Future Smouha report pages atomic/idempotent/ordered, no content truncation. Cleopatra report enqueue unchanged. Consumption valuation uses period movement quantities with same visibility/authorization and latest approved prices, with missing prices explicit.

## Baseline
#519 merged/deployed4b31f241. Production migration20261016160559, cashier2 inactive. Premerge1814/1091/134 green; postmerge one pre-existing WAL median failed.

## Root-cause ledger
00:50 Cairo read:2h Smouha5 kitchen/23 receipts/2 reports submitted; Cleopatra13 kitchen/19 receipts submitted. No non-submitted jobs in window; no active user query >5s. Submitted is not paper confirmation. Latest reports9891/9897chars341source lines; still tall text raster on unchanged agent. Bound only future reports, hardware acceptance still needs operator paper observation.
Consumption RPC still uses historical ledger total_cost for actual costs and latest price only for negative estimates. Replace this operational read with quantity times latest approved price, grouped before pricing. Never rewrite historical valuations/journals.
WAL benchmark savepoint rollback leaves physical heap/index state and identity progression different. Production purchase-price trigger has purchase-only WHEN. Test direct zero price-trigger calls/projection change on issues and verify an eligible purchase fires the detector; retain WAL observations as diagnostics. No production trigger change.

## Change ledger
Candidate migration adds two authorized read-only operational RPCs: consumption aggregates visible period quantities first then prices distinct raws; stock valuation reads only compact branch balances and latest-price projection. Existing historical valuation RPCs and business writers remain unchanged. Costing period/current-value tab and closing reports use latest-price reads, explicit missing-price markers and labels. Smouha report enqueue now creates bounded320-character/12-newline standard-text pages atomically, ordered with microsecond created_at offsets; same-key root dedup prevents replay of old reports. Claim/start/complete unchanged. WAL test now asserts zero price-trigger calls/rows on issues, with an eligible purchase positive control; total WAL samples remain diagnostic, and concurrency has its own test.

## Verification ledger
Read-only production baseline above. Full app/test typechecks and targeted lint passed;18 targeted UI/report/worklog tests passed, including explicit latest-price and missing-price rendering. A further full-queue read found no pending/claimed/printing or retryable-failed jobs in either branch. New owned-localhost integration tests cover page bounds/order/content/idempotency/collision rollback, last-price versus historical cost, unknown price, permissions and no quantity mutation. Full exact-head CI pending.

## Production gate
Owner authorizes repair now while retaining current printing. Require exact-head CI before SQL apply, reconcile actual migration history and re-verify before merge/deploy. No extra physical job or historical replay for verification.

## Next action
Implement/test bounded report pages and latest-price consumption, with read/permission/value tests and WAL causality proof.

## Mandatory update protocol
One writer. Unexpected remote head STOP_AND_RECONCILE. Update log and PR ledger as gates change. Do not hide failed WAL samples or re-run until green; explain replacement invariant and positive control.
