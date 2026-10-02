# ERP-04 UNIFIED ACCOUNTING POSTING — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/erp04-unified-accounting-posting-20261003`
Current PR: `#433`
Baseline: `main@b44298405066e1bcf06cc8eb0e3678b1c7d21fc7`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

## Guardrails
- Audit first; no speculative migration.
- No direct write to `main`; no force push; single writer.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- No Production DB/schema/data/history write without separate explicit approval.
- Preserve Permission-First, RLS, branch isolation, idempotency and audit history.
- Never silently rewrite posted journal truth.
- Printing / Print Agent / routing / KDS / kitchen / `send_to_kitchen` are frozen.

## Baseline
- Latest `main` and this branch reconciled at `b44298405066e1bcf06cc8eb0e3678b1c7d21fc7`.
- No open PR existed at branch creation or the latest reconcile.
- Production contract parity is healthy and the prior idle performance baseline is healthy.
- Accounting foundation exists: `journal_entries`, `journal_entry_lines`, `chart_of_accounts`, `account_mappings`, `_post_journal_entry`.

## Root-cause ledger
1. ERP-04 is the next P0 roadmap item not formally closed.
2. Sales delegate to `_process_sale_core`, which uses `_post_journal_entry`.
3. Purchases, purchase returns, supplier treasury payments, treasury deposit/withdraw/transfer and manual journals use the central writer.
4. Split sale/refund reuse the canonical journal and only replace collection-side cash/bank lines.
5. Purchase delete is fail-closed once inventory/accounting postings exist; purchase edit uses reversal + replacement.
6. `apply_stock_count` changes product/raw inventory through FIFO helpers but does not post GL.
7. Existing manual `adjust_stock` and `adjust_raw_stock` post `inventory_fg|inventory_rm <-> stock_variance`.
8. The required mappings exist for both active Production branches.
9. `resolve_account_key` returns NULL when a mapping is absent, so a missing mapping can be used to verify fail-closed atomic rollback.
10. Supabase CLI is not installed in the execution container and network package fetch timed out; migration naming will therefore follow the repository timestamp convention and this exception is recorded here.

## Change ledger
- Dedicated ERP-04 branch created from exact latest main.
- Accounting-path audit completed for sale, split sale/refund, purchase correction/delete, treasury, manual journal and stock count.
- Runtime implementation not yet committed at this checkpoint.

## Verification ledger
- Production required tables: 54/54.
- Production required RPC names: 154/154.
- Central writer usage confirmed for canonical financial flows.
- Stock-count accounting gap proven by live function-definition inspection and repository integration tests.
- Existing stock-count tests cover FIFO/lifecycle/idempotent terminal state but do not assert GL posting.
- Fast Verify: pending after implementation.
- Full Verify / DB / Security-RLS / Browser Smoke: pending.
- Production migration: none.

## Production gate
State: **BLOCKED**
- Production remains read-only.
- Any future Production migration requires exact-head Full Verify Green, final reconcile and explicit user approval.

## Next action
Implement one additive migration that preserves the stock-count lifecycle but accumulates actual FIFO-valued product/raw variance and posts one balanced `stock_count` journal. Add DB-backed coverage for mixed positive/negative variance, one-journal idempotency and rollback on missing account mapping.

## Mandatory update protocol
- Re-read latest `main` and expected branch HEAD before every repository write.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Update this log after every material audit, implementation or verification checkpoint.
- Keep State **BLOCKED** until exact-head Full Verify Green and explicit merge approval.
