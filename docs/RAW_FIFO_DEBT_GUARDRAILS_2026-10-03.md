# RAW FIFO DEBT GUARDRAILS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/raw-fifo-debt-guardrails-20261003`
Current PR: `#435`
Baseline: `main@bbc866904a05317046b738bde94b9e23dae839cf`
Last updated: 2026-10-03

## Work status
State: **BLOCKED**

## Guardrails
- No direct write to `main`; no force push; single writer.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Existing negative raw-material sell-through remains enabled for sale, kitchen-send and auto-sale-production.
- Strict callers remain strict.
- No Production stock quantity, COGS, journal, settlement, sales, purchases, shifts, payments or printing write in the audit/design phase.
- Printing, Print Agent, KDS routing, printer routing and `send_to_kitchen` behavior remain frozen.

## Baseline
- Latest reconciled main: `bbc866904a05317046b738bde94b9e23dae839cf`.
- No open PR existed when this branch was created.
- Database health at audit time: 0 idle-in-transaction, 0 lock waits, 0 >30s transactions, 0 historical deadlocks.
- Accounting audit: 2,933 journal entries, 0 unbalanced journals, 0 journals without lines.
- Closed shifts are internally consistent.
- Finished-goods inventory has no negative rows.

## Root-cause ledger
1. Raw-material negative stock is not an integrity mismatch: 145/145 negative raw-material warehouse balances are backed by tracked FIFO debt.
2. Canonical `_raw_remove_fifo(..., p_allow_negative=true)` intentionally creates `OV-*` debt batches plus `raw_fifo_debts`.
3. Live callers that deliberately allow negative raw stock are sale deduction, kitchen-send deduction and auto-sale-production.
4. Strict manual/stock-count/transfer paths remain non-negative.
5. FIFO debt settlement is functioning on later positive receipts/additions; historical fully and partially settled debts exist.
6. Current operational issue is unbounded/poorly visible outstanding debt, not missing FIFO traceability.
7. Production currently has 145 negative locations; 89 have a known estimate cost and 56 are genuinely unpriced.
8. Many of the largest outstanding materials have no true purchase receipt history in the same warehouse, so automatic quantity repair would invent business data and is forbidden.
9. Existing `get_current_raw_material_valuation(uuid)` returns JSONB, so debt health can be added without changing the RPC signature.

## Change ledger
- Planned migration: extend `get_current_raw_material_valuation(uuid)` output only.
- Planned debt-health fields:
  - outstanding FIFO debt quantity;
  - outstanding debt row count;
  - oldest outstanding debt timestamp;
  - last true purchase-receipt timestamp;
  - known estimate unit cost;
  - estimated debt value;
  - deterministic status: `OK`, `OUTSTANDING`, `NO_RECEIPT_HISTORY`, `UNPRICED`.
- Planned UI: expose those fields in the existing raw-material current-cost report.
- No change planned to sale/KDS/auto-production deduction behavior.
- Supabase CLI is unavailable in this execution environment; migration filename creation will follow the repository timestamp convention and this exception is recorded here.

## Implementation checkpoint
- Added forward-only migration `20261003084500_raw_fifo_debt_health_guardrails.sql`.
- `get_current_raw_material_valuation(uuid)` keeps the same signature, auth/permission checks and grants.
- Debt health is warehouse-aware and branch-scoped; priced debt uses `_raw_last_known_fifo_cost` only for estimate/display.
- UI and Excel now expose outstanding debt, pricing coverage, receipt history and deterministic debt status.
- Added unit contract and Fresh-DB integration regression tests.
- Migration contains no INSERT/UPDATE/DELETE against business tables and does not call stock mutation helpers.

## Verification ledger
- Production audit is read-only and complete for database health, journals, shifts, raw balances, batches, FIFO debt and debt pricing.
- No Production writes performed in this workstream.
- Initial exact-head `63e1289a338732dec39e91c38d80ce517e24d908`: Fresh DB/schema/integration/security/RLS ✅ Green; PR scope ✅ Green.
- `Verify main` run `37110811208` stopped before lint/typecheck/tests only because the mandatory worklog lacked the `Current PR` line; runtime/migration code was not implicated.
- Documentation-only correction adds `Current PR: #435`; a new exact-head CI run is required.
- Browser smoke: pending on the corrected head.

## Production gate
State: **BLOCKED**
- No Production migration has been applied.
- No merge has been performed.
- Production apply is allowed only after exact-head Full Verify Green, final reconcile and explicit user approval.

## Next action
Open a Draft PR on the exact implementation head and run exact-head verify, Fresh DB/schema/integration/security/RLS and browser smoke. Production remains blocked until those checks are Green.

## Mandatory update protocol
- Re-read latest `main` and expected branch HEAD before every repository write.
- Unexpected divergence => **STOP_AND_RECONCILE**.
- Keep this log synchronized with material implementation and verification checkpoints.
- Keep State **BLOCKED** until exact-head CI is Green and merge/Production gates are satisfied.
