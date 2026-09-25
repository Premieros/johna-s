# UNIFIED BUSINESS METRICS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/unified-business-metrics-20260925`
Current PR: `#368`
Last updated: 2026-09-25

## Work status

State: **BLOCKED**

Implementation reached Full Verify Green on `6f701fb512b2dbb63f2dbe9f64683286a718e7e2` (Verify #2782), then `main` advanced by 3 commits. The branch was reconciled with `main` using a normal merge commit with no force push. Merge remains blocked until the reconciled exact-head Full Verify is green and explicit approval is given.


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

## Baseline

- Base main: `6726103b3dbadf82f4b81b18c6648fc148479a9f`.
- Existing historical visibility: last 7 days complete; older rows follow permission-scoped historical visibility unless `history.unlimited` is granted.
- Existing authoritative sources include operational tables/RPCs, accounting journals, `inventory_ledger`, FIFO `raw_material_batches`, and day-closing RPCs.

## Root-cause ledger

1. The same business meaning was surfaced from different sources across Finance, Reports, Inventory, and Purchases.
2. Generic `credit` labels obscured whether the value meant supplier payable, customer receivable, or a payment method.
3. Raw-material inventory value could be shown from local average cost while finance used FIFO valuation.
4. Historical visibility limits could make a visible total look like a full-branch total unless the scope was disclosed.

## Change ledger

- Added shared user-facing business metric helpers.
- Aligned supplier/customer outstanding labels across Finance, Reports, and Purchases.
- Removed conflicting raw-material avg-cost valuation from the inventory user surface.
- Added permission-scope disclosure on Reports, Finance, Purchases, and Inventory Ledger.
- Added contract coverage for metric semantics and history-scoped disclosure.

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

## Visibility / permission scope

Unified metrics never bypass `history.unlimited`, branch isolation, or table/RPC visibility rules.

For users without `history.unlimited`:
- the most recent 7 days are fully visible;
- older history follows the deterministic historical visibility policy;
- every displayed total, reconciliation, and export must mean **total of data visible to this user**, not the absolute branch total;
- current inventory truth is not historically sampled, but historical inventory movement is;
- per-visible-invoice supplier/customer outstanding remains exact for that visible invoice;
- a screen must disclose when historical totals are permission-scoped.

A metric is considered "the same number everywhere" only when compared under the same branch, date range, filters, and visibility permissions.

## Verification checklist

- [ ] Same supplier outstanding in Purchases, Finance, and Reports.
- [ ] Same customer outstanding in Finance and Reports.
- [ ] Same cash/card figures in Reports and day closing.
- [ ] Same raw-material consumption in Inventory and Reports.
- [ ] Same current raw-material value in Inventory and Finance report.
- [ ] Bank balance is never presented as card sales.
- [ ] Split payments are decomposed before user-facing totals.
- [ ] Excel exports match screen values and labels.

## Verification ledger

- PR #368 first verify failed on stale active-worklog branch/path hard-coding.
- Active worklog pointer was corrected to this file and branch.
- Latest verify then failed because the gate still hard-coded the prior log filename and this log lacked mandatory structural headings.
- Gate repair now validates the declared active log path dynamically while preserving strict structure and branch matching.
- Verify #2782 on `6f701fb512b2dbb63f2dbe9f64683286a718e7e2`: FULL GREEN (verify + DB + integration/RLS + browser-smoke).
- `main` then advanced to `1f2bbadac7f6d27faa571f2726c028f5366a856d` with PR #367 Cleopatra realtime wake repository sync.
- Reconciled via merge commit `baa396d10f92164256907e878b17c5f5e2280491`; branch is now ahead 25 / behind 0.
- Reconciled exact-head Full Verify: pending.

## Production gate

State: **BLOCKED**

- Merge: blocked until exact-head Full Verify Green + explicit approval.
- Production migration: not required by this UI/semantic work and remains blocked.
- Printing / Print Agent / KDS / shifts remain untouched.

## Next action

Run exact-head Full Verify for reconciled head `baa396d10f92164256907e878b17c5f5e2280491` (or the subsequent log-update head) and stop before merge.

## Mandatory update protocol

- Before every write, verify branch HEAD against the expected prior commit.
- Unexpected HEAD = STOP_AND_RECONCILE.
- Update this log after each change group and verification result.
- Do not merge or change Production while State is BLOCKED.
