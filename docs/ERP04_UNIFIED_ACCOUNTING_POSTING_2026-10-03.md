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
- No direct write to `main`; no force push; single writer.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- No Production DB/schema/data/history write without separate explicit approval.
- Preserve Permission-First, RLS, branch isolation, idempotency and audit history.
- Never silently rewrite posted journal truth.
- Printing / Print Agent / routing / KDS / kitchen / `send_to_kitchen` are frozen.

## Baseline
- Latest `main` baseline: `b44298405066e1bcf06cc8eb0e3678b1c7d21fc7`.
- Draft PR #433 is the sole active ERP-04 path.
- Production remains healthy/read-only for this track.
- Existing canonical accounting writer: `public._post_journal_entry`.

## Root-cause ledger
1. Sales, purchases, purchase returns, treasury flows and manual journals already converge on the central writer.
2. Split sale/refund are intentional extensions of canonical journals, changing only collection-side cash/bank lines.
3. Purchase delete is fail-closed after posting; purchase edit uses reversal + replacement.
4. `apply_stock_count` changes product/raw inventory through FIFO helpers but previously did not post GL.
5. Manual inventory adjustment semantics define the target accounts: `inventory_fg|inventory_rm <-> stock_variance`.
6. Positive stock-count variance is valued from the count item's stored FIFO/average unit cost; negative variance uses the actual FIFO removal result.
7. The required account mappings exist for both active Production branches.
8. Supabase CLI is unavailable in the execution container and package fetch timed out; migration naming follows the existing repository timestamp convention only. Production migration history is untouched.

## Change ledger
Implemented on PR #433:
- `supabase/migrations/20261003030000_erp04_stock_count_accounting_posting.sql`
  - preserves existing permission, branch, lifecycle and FIFO paths;
  - accumulates finished-goods and raw-material valuation deltas;
  - posts one balanced `stock_count` journal through `_post_journal_entry`;
  - uses `inventory_fg`, `inventory_rm`, and `stock_variance`;
  - returns `journal_entry_id` without changing existing success/error keys.
- `tests/integration/stock_count_accounting_posting.test.ts`
  - mixed product increase + raw-material decrease with exact journal values;
  - retry remains terminal and does not create a second journal;
  - missing required mapping in an isolated test branch causes posting failure and verifies inventory/batches/status rollback.
- No Production migration applied.
- No printing/KDS/POS runtime file changed.

## Verification ledger
- Branch/main reconcile before implementation: clean.
- Draft PR: #433.
- Migration and test re-fetched from the branch and structurally reviewed.
- Focused DB integration: pending CI isolated PostgreSQL.
- Full Verify / DB / Security-RLS / Browser Smoke: pending.
- Production migration: none.

## Production gate
State: **BLOCKED**
- Production remains read-only.
- Do not apply the migration until exact-head Full Verify is Green, the PR is reconciled with latest main, and the user separately approves Production migration/merge actions.

## Next action
Run exact-head CI on the final documentation/implementation head. Inspect failures narrowly. If all verify/db/browser gates are Green, perform final main/head reconcile and present the exact merge/Production migration decision for explicit approval.

## Mandatory update protocol
- Re-read latest `main` and expected branch HEAD before every repository write.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Update this log after every material audit, implementation or verification checkpoint.
- Keep State **BLOCKED** until exact-head Full Verify Green and explicit merge approval.


## CI checkpoint — stock-count fixture correction
- Exact-head `37f43540c008a386584ea7260b92dfc46035236c`:
  - `verify`: **GREEN**.
  - canonical migrations/schema: **GREEN**; ERP-04 migration applied successfully on Fresh DB.
  - DB integration suite: **FAILED only in the new ERP-04 test fixture before either test ran**.
  - failure: duplicate `account_mappings(branch_id, semantic_key)` for `inventory_fg`.
- Root cause: `ensure_chart_of_accounts(rollbackBranchId)` already seeds canonical account mappings, while the test fixture attempted to insert `inventory_fg` again.
- Correction commit `8a13a76f5460d2c15212d04c87c4aa632de56034`:
  - no migration/runtime change;
  - fixture now seeds canonical mappings once, then renames only the isolated rollback-branch `stock_variance` semantic key to `stock_variance_missing_probe`;
  - this preserves a valid `inventory_fg` mapping while still exercising the intended fail-closed missing-variance-account path.
- Production remains untouched.
- Next gate: exact-head Full Verify on the documented final head; no merge or Production migration before Green + explicit approval.
