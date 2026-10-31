# FIFO receipt performance — 2026-10-31
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/fifo-receipt-write-amplification-20261031`
Current PR: #559
Last updated: 2026-10-31
State: **BLOCKED**

## Work status
Owner approved staged improvement of historical FIFO-debt settlement before continuing approved raw material price cutover. Candidate optimizes one proven write-amplification point while retaining every canonical settlement and cost propagation. No production changes have been performed.

## Guardrails
Do not approve #00008, change any real stock balance, alter historical FIFO debt, drop reconciliation, bypass accounting, modify customer invoices, turn off kitchen sale COGS or casually raise PostgREST request timeout. All release testing against disposable Postgres with rollback. No merge/deploy unless 717-debt performance and correctness proves the 30-second incident is addressed. No optimistic auto-retry.

## Baseline
Main `2eece503c7d2a70ec5fa8806a815d0a7934d8365`, integrated transfers PR #556. Existing candidate `scripts/experiments/raw_fifo_receipt_reuse_candidate_20261013.sql` compares original receipt behavior with one receipt-batch update after 100 FIFO sources. Production `_raw_fifo_settle_receipt` currently writes the exact same positive receipt batch once per debt (source loop), creating avoidable lock, index and trigger work. Existing `_fifo_adjust_kitchen_effect_delta` and `_fifo_adjust_sale_cogs_delta` also adjust hundreds of historical records; optimizing batch writes alone might NOT resolve the user-visible 30-second timeout.

## Root-cause ledger
Issue #557: source espresso in Cleopatra negative; receiving Smouha espresso 717 unsettled debts (707 kitchen send, 473 unique sales and many estimated prices), 30-second SQLSTATE 57014 during kitchen/sale FIFO COGS reconciliation. Actual transfer #00008 remained pending and had 0 stock journal/debt references. Last approved pricing source exists. Historical accounting cannot be skipped.

## Change ledger
`scripts/db/candidates/fifo_receipt_reduce_batch_writes_20261031.sql` is a guarded UNWIRED candidate using current stored function source text with 3 matched unique anchors. For sale/kitchen sources only it defers updates on receiving positive batch and flushes the accrued quantity once after complete successful loop; for transfer, production, purchase return or unsupported references it flushes before calling recursive cost propagation. It preserves every ledger, debt, settlement, COGS and journal update in the same PostgreSQL transaction. Uses exact `SECURITY DEFINER` function signature and does not expose new RPCs. A schema-only drift-guarded rollback is staged in `scripts/rollback/fifo_receipt_reduce_batch_writes_20261031.sql`; neither forward candidate nor rollback modifies existing stock rows directly.

## Verification ledger
Read-only production SQL proved all 3 replacement anchors match exactly once. New disposable DB integration test `fifoReceiptBatchWriteConsolidation.test.ts` compares original canonical versus patched behavior on 120 FIFO debts, including batch balances, inventory, negative source cost, 120 settlements, sale COGS and journal lines, one idempotent repeat; records and asserts receipt batch UPDATE reduction 120→1. Exact-head CI pending. Existing `rawReceiptReuseCandidate.test.ts` previously verified prototype with 100 sale-sourced debts, partial and zero-cost receipts and error rollback. New `fifoReceiptKitchenBacklogBenchmark.test.ts` generates 717 synthetic kitchen debts across 473 settled sales and runs canonical patched receipt inside one rollback-only transaction; asserts all 717 settlements, event/effect costs, sale adjustments, and balanced journals and prints elapsed milliseconds. The 30-second production budget is still unproven until this CI result and representative concurrency testing.

## Production gate
**BLOCKED** until full CI and reproducible >700 kitchen debts with source and receiver debt, journal parity, serial/concurrent safety, full cost and accounting checks, and measurable end-to-end approval under PostgREST budget. A second design may be needed for batched journal posting or durable async reconciliation; never mark transfer approved ahead of required accounting. Do not merge candidate alone and tell owner timeout fixed.

## Next action
Inspect integrated exact-head CI logs, correct test failures, measure representative kitchen/sale workload and assess whether this partial improvement is sufficient. Then decide a released change with complete rollback and explicit authorization.

## Mandatory update protocol
Update after each substantive change and verification; CI mandatory worklog must fail if absent. No production FIFO/SQL mutating tests.
