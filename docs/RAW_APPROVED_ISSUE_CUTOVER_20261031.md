# Raw approved issue costing — staged cutover pilot
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/raw-approved-price-issue-cutover-20261031`
Current PR: #558 (draft target)
Last updated: 2026-10-31
State: **BLOCKED**

## Work status
Owner confirmed that last known APPROVED price is canonical across Johna's and authorized implementation. The present PR intentionally stages a rollback-only, disposable PostgreSQL experiment and tests first. It does NOT change any production business writer or schema when merged; SQL lives in `scripts/db/candidates`, not `supabase/migrations`. No live transfer is used as test.

## Guardrails
Do not change any existing stock quantity, FIFO batch, debt, sale, kitchen event, journal, income statement, historical prices or access control on production. Never disable FIFO debt reconciliation merely to avoid a timeout. No auto-retry of a transfer. Preserve source branch and date, exact authorization, negative-stock permission, physical FEFO/FIFO lot traceability, frozen business documents and balanced accounting.

## Baseline
Production last-known authoritative price source: `private.latest_approved_raw_prices`. Existing recipe costing, kitchen ingredient snapshots and current consumption reports use it; cross-branch destination transfer prices are frozen from receiving branch. Existing warehouse FIFO removal still values positive lot consumption at batch cost and negative `OV-*` consumption at zero, subsequently triggering historical reconciliation on receipt. Existing open receiver backlog on Smouha espresso has 717 FIFO debts and times out after ~30 seconds on #00008.

## Root-cause ledger
New raw oversold ledgers are zero-priced, yet latest approved price is 1200 for the same espresso source and destination. Receipt `_raw_fifo_settle_receipt` unconditionally sets `v_delta=actual_receipt_cost` for zero-valued debts and propagates corrections into historical kitchen/sale journals. Simply setting a nonzero issue cost without modifying receipt settlement would DOUBLE count; changing prices without immutable source provenance introduces repricing risks. Source-purchase/raw-cost semantics are distinct from physical lot selection.

## Change ledger
- `scripts/db/candidates/raw_approved_price_issue_pilot_20261031.sql` (UNWIRED, disposable only): injects a guarded prototype into the current negative/raw FIFO path, freezes approved source price with price identity/date on new oversold ledger, and records true receipt-price minus approved-price difference as a private, UNPOSTED variance instead of retroactively rewriting source ledgers.
- No price -> do not invent a default: keep legacy zero and mark explicitly unpriced by absence of snapshot.
- Existing older debts and their code paths remain untouched. Physical batch depletion order remains untouched. Positive-lot cost is not changed by this pilot; it is a separate release stage.
- Variances are tracked but **not journal posted**; posting design and proofs must precede release. A test-only diff cannot be regarded as approved journal logic.

## Verification ledger
New integration test `rawApprovedIssuePricePilot.test.ts` runs only with a localhost disposable Postgres and always rolls back the transaction. Scenarios: approved negative issue at 1200 (not zero), equal receipt cost (no double counting), changed receipt cost (225 pending variance), no approved price (no invented price), and direct private table privilege checks. CI not yet completed. Exact live function source text guard checks also pending.

## Production gate
**BLOCKED**. Do not merge or deploy the candidate SQL. Before any activation implement verified exact source-approved costs for ALL new raw material consumption, not only oversold portion; resolve kitchen/sale snapshot/journal alignment; deliver idempotent, reconciled and accounted variance posting with balanced journal, independent period boundaries, retries and rollbacks; reconcile current 717 historical debts with a bounded safe worker; prove under 30-second PostgREST budget and concurrent approval. Require exact-head full CI plus explicit release approval.

## Next action
Run guarded function-source comparison and isolated PostgreSQL pilot. Fix local test failures. Create approved variance accounting plan and bounded FIFO historical backlog reconciler without altering old documents. No live customer writes.

## Mandatory update protocol
Update this log after CI, migrations, security/ledger reviews and release gates. CI should block if active log missing. No Merge or Production migration before final release checks and approval.
