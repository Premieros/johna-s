# UNIFIED BUSINESS METRICS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/unified-business-metrics-20260925`
Date: 2026-09-25

## Goal

Make Finance, Reports, Inventory, and Purchases show the same business meaning for the same number.

The user-facing surface must not expose accounting implementation details as if they were operational KPIs. Journal debit/credit remains available inside Trial Balance / General Ledger only.

## Guardrails

- Single Writer only.
- No direct write to `main`.
- No force push.
- No Production migration without Full Verify Green + explicit approval.
- Printing / Print Agent / KDS / shifts are out of scope.
- Preserve branch isolation and permission checks.

## User-facing metric contract

| Business metric | User-facing Arabic label | Authoritative source | Notes |
|---|---|---|---|
| Net sales | صافي المبيعات | completed/paid sales after refunds/returns using reporting/day-close contract | Do not derive from bank/cash ledger balances |
| Cash sales | مبيعات نقدية | day-closing/payment allocation contract | Split payments must be decomposed into real components |
| Card sales | مبيعات كارت | day-closing/payment allocation contract | Bank balance is not card sales |
| Customer outstanding | مستحق من العملاء | `get_ar_aging` / open operational receivables | Includes open credit inside split payments and employee receivables where applicable |
| Purchases | إجمالي المشتريات | `purchases` completed operational invoices | Returns shown separately / netted consistently |
| Supplier outstanding | مستحق للموردين | `get_ap_aging` / purchase open amount | Formula: total - paid - returned. Trial-balance AP is reconciliation detail, not the primary user KPI |
| Inventory movement | حركة المخزون | `inventory_ledger` | One movement ledger for all reports |
| Raw-material consumption | استهلاك الخامات | `inventory_ledger` actual consumption value | No guessed/latest purchase price |
| Current raw-material value | قيمة رصيد الخامات | residual `raw_material_batches` FIFO value | Same value in inventory and finance reports |
| Day cash position | صافي حركة اليوم النقدية | `get_day_closing_report` / range derivative | Must match day close/shift closing semantics |
| Bank balance | رصيد البنك | treasury/bank account statement | Must never be labelled or compared as card sales |
| Cashbox balance | رصيد الخزنة | treasury account statement | Internal transfers are movements, not revenue/expense |

## Naming rules

- Never show raw `credit` as a standalone Arabic business label.
- Purchase `credit` => **آجل — مستحق للمورد**.
- Sales `credit` => **آجل — مستحق من العميل**.
- `Accounts Payable` => **مستحق للموردين** on operational/user-facing screens.
- `Accounts Receivable` => **مستحق من العملاء** on operational/user-facing screens.
- Debit/Credit terminology is allowed only in Trial Balance, General Ledger, and explicit accounting drill-down views.

## Reconciliation rule

Operational KPI = source of truth shown to the user.

Accounting ledger = reconciliation/audit evidence.

If the operational KPI and ledger differ, the product must:
1. keep the operational KPI label clear;
2. expose the difference only in an accounting reconciliation/drill-down;
3. never silently replace the operational KPI with a ledger balance.

## Scope

### Finance
- User-facing summaries use business labels above.
- Trial Balance / Ledger retain debit-credit terminology.
- AP/AR cards and statements use operational outstanding values.

### Reports
- Same metric labels and sources as Finance.
- No duplicate recomputation of sales/payment/inventory/purchase totals.
- Excel exports use the same labels and values shown on screen.

### Inventory
- Quantity/movement from inventory ledger.
- Current raw-material value from residual FIFO batches.
- Consumption value from actual ledger consumption.

### Purchases
- Invoice total, paid, returned, and supplier outstanding must reconcile to AP aging.
- Credit purchase label is explicit: supplier outstanding, not bank/card/credit jargon.

## Verification checklist

- [ ] Same supplier outstanding in Purchases, Finance, and Reports.
- [ ] Same customer outstanding in Finance and Reports.
- [ ] Same cash/card figures in Reports and day closing.
- [ ] Same raw-material consumption in Inventory and Reports.
- [ ] Same current raw-material value in Inventory and Finance report.
- [ ] Bank balance is never presented as card sales.
- [ ] Split payments are decomposed before user-facing totals.
- [ ] Excel exports match screen values and labels.
