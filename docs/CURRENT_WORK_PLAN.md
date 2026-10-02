# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **ERP-04 Unified Accounting Posting**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `b44298405066e1bcf06cc8eb0e3678b1c7d21fc7`
- Active development branch: `development/erp04-unified-accounting-posting-20261003`
- Mandatory active work log: `docs/ERP04_UNIFIED_ACCOUNTING_POSTING_2026-10-03.md`

## Safety fence
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا السجل الإلزامي مفقود أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`.
- No force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- No Production DB write, schema change, data rewrite, migration-history repair or journal backfill without separate explicit approval.
- Preserve Permission-First, RLS, branch isolation, idempotency and audit history.
- Never silently rewrite posted journal truth.
- Printing, Print Agent, printer routing, KDS and `send_to_kitchen` are frozen.

## Current objective
Close ERP-04 by proving and fixing only real accounting-posting gaps. The first proven gap is stock-count application: inventory quantity changes are applied through FIFO helpers but no GL entry is posted, while manual stock adjustments already post inventory-versus-stock-variance journals.

## Measured basis
- Core sale posting reaches `_post_journal_entry` through `_process_sale_core`.
- Purchase, purchase-return, treasury and manual journal flows already use the central journal writer.
- Split sale/refund paths intentionally reuse the canonical journal and replace only collection-side cash/bank lines.
- `apply_stock_count` changes product/raw stock but does not call the central journal writer.
- Existing account mappings `inventory_fg`, `inventory_rm`, and `stock_variance` exist for both active Production branches.
- Production remains read-only for this track until explicit approval.

## Definition of done
- Applying a stock count posts one balanced, idempotent journal tied to the stock-count document.
- Positive/negative product and raw-material variances use the same accounting semantics as existing manual adjustment RPCs.
- Posting failure rolls back the stock-count inventory mutation atomically.
- Existing count lifecycle, permissions, FIFO behavior and idempotent terminal status remain unchanged.
- Exact-head Full Verify + DB/security/RLS + Browser Smoke are Green.
- Final branch/main reconciliation is clean.
- Merge and any Production migration occur only with explicit approval.

> Older work plans/logs are archival evidence only unless this file explicitly names them as active.
