# Raw-material COGS accounting — 2026-10-04

## Scope
Future-only accounting correction. Production data is read-only during diagnosis.

## Root cause
Operational sale inventory deduction consumes raw materials / inventory units, but the current sale journal posts the inventory side of COGS to semantic key `inventory_fg` (account 1200). FIFO sale-cost reconciliation also targets `inventory_fg`.

## Production evidence
- Sample sale `Johna's-02118`: COGS debit 82.71 and account 1200 credit 82.71.
- The same sale has raw-material inventory effects and no finished-product inventory effect.
- 30-day effect scan: raw-material effects dominate; product-target sale effects were not observed.
- 1200 balance is negative in both active branches, consistent with repeated sale/FIFO credits rather than real finished-goods stock.

## Repair design
1. Keep callers stable but remap sale/refund/fifo journal legs from `inventory_fg`/1200 to `inventory_rm`/1210 inside `_post_journal_entry`.
2. Switch new direct FIFO COGS reconciliation journals to `inventory_rm`.
3. If a FIFO reconciliation journal already exists historically, continue using its existing inventory account when later deltas update it. This prevents one historical journal from mixing 1200 and 1210.
4. Do not alter purchase, stock-count, physical inventory deduction, KDS, POS settlement, printing, shifts, or historical journal rows.

## Files
- `supabase/migrations/20261004133000_raw_material_cogs_accounting.sql`
- `tests/unit/rawMaterialCogsAccountingContract.test.ts`

## Safety gates
- No Production mutation in this phase.
- Exact-head CI required.
- Production apply requires explicit approval after review.
- Historical reclassification is a separate phase and must be computed/proven independently.
