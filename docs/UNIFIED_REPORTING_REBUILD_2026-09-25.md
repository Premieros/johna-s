# Unified Reporting Rebuild — Source of Truth

Status: IN PROGRESS
Branch: development/component-consumption-reconciliation-20260925
Production: NOT APPLIED

## Goal
One Reports Center. A business metric has one canonical definition and one canonical data source. Screens and Excel exports must consume the same result instead of recalculating the same metric independently.

## Canonical metric contracts

| Metric family | Canonical source | Contract |
| --- | --- | --- |
| Net sales | sales + canonical refunds/settlements | SUM(max(total - refunded_amount, 0)); tax is shown separately, not silently removed from net sales |
| Payment split | private.report_sale_settlement_lines / get_sales_by_payment_report | cash/card/transfer/credit/legacy_bank derived from one settlement resolver |
| Day close | get_day_closing_report / get_day_closing_range_report | same net sales and payment settlement resolver as sales reports |
| Shift close | get_shift_closing_report | must reconcile to the same sales/refund semantics for the shift scope |
| COGS / sales consumption value | canonical COGS resolver: journal COGS, then settled kitchen, then legacy sale ledger fallback | used by Costing Center and reports |
| Raw material movement | inventory_ledger | quantities and historical movement/value |
| Current raw inventory valuation | raw_material_batches | remaining FIFO quantity/value |
| Theoretical component consumption | resolve_product_raw_components × net sold quantity | read-only theoretical BOM metric |
| Actual component consumption | inventory_ledger tied to same direct sale or settled kitchen sale | compared with theoretical consumption |
| Purchases | purchases / purchase_items | returned amount handled explicitly |
| Expenses | posted expenses; accounting statements use journal postings | operational and accounting labels must not imply they are the same basis |
| Treasury/bank | journal_entry_lines + treasury_accounts | no purchase/credit inference from payment_method |
| Income statement / balance sheet / ledgers / aging | accounting RPCs over journal entries | accounting source of truth |

## Reports kept in the new center
- Sales summary and invoice detail
- Sales by payment
- Sales by product
- Returns
- Purchases
- Expenses
- Day closing range
- Shift/day links where applicable
- Raw material movement & consumption
- Current raw material valuation
- Sales vs component consumption reconciliation
- Inventory item statement
- Treasury/bank statement
- Trial balance
- General ledger
- Income statement
- Balance sheet
- AR/AP aging and summary
- Cash flow / treasury movement
- Party statement
- Financial reconciliation
- Costing sales summary/order margin (same COGS contract)

## Legacy/ambiguous reports removed from discovery
- component_consumption based on stock_transactions.component_flow
- recipe_costs / manufacturing language as a separate production system
- duplicate profit calculations that do not use the accounting income statement
- any report that recomputes payment split outside report_sale_settlement_lines

## Invariants
1. Net sales in Reports, Day Close, Shift Close and Costing use the same semantic definition.
2. Payment-method totals use the settlement resolver and must sum to settled amount.
3. COGS shown in reports and Costing Center must resolve through the same COGS contract.
4. Raw consumption reports use inventory_ledger, never legacy stock_transactions component flow.
5. Excel is a presentation of screen data and never recomputes business totals.
6. No reporting change mutates sales, inventory, kitchen, printing, shifts or accounting data.
