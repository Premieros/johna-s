# Shift Close / Sale Trace / Cash Outflow Repair — 2026-09-22

## Scope

This repair is intentionally limited to:
1. Preserve and expose the original POS order number beside the financial sale invoice number.
2. Make the shift-close UI honor the authoritative RPC result and expose the already-existing close-with-open-orders path when explicitly permitted.
3. Deduct posted cash expenses and in-shift cash purchases from expected drawer cash.

Printing agents, kitchen print routing, receipt templates, and customer receipt layout are not changed.

## Branch

`development/shift-close-sale-trace-cash-purchases-20260922`

Base:
`main@3e7e198c7c8854a26fcca925174fc51a571b8787`

## Root causes confirmed

### Sale / order trace
Order numbers and sale invoice numbers are allocated from independent server sequences. The sale record did not persist the originating order id, even though kitchen settlement events had the mapping.

### Shift close
The POS shift modal called `close_shift` but ignored a returned JSON payload with `success=false`. Open-order blocking therefore looked like a dead close button. The shifts administration page already handled this correctly.

### Cash outflows
`_compute_shift_expected_cash` used only `shift_operations`. Posted expenses are represented there, but cash purchases are not. Cash purchases therefore did not reduce expected drawer cash.

## Changes

- Migration `20260922184000_shift_cash_purchase_sale_trace.sql`
  - adds nullable `sales.source_order_id` FK and index;
  - backfills unambiguous historical order/sale mappings from kitchen settlement events;
  - keeps future mappings synchronized from settlement events;
  - recalculates expected cash as opening + cash inflows - cash refunds/outflows - posted cash expenses - in-window cash purchases;
  - avoids double-counting posted expenses that also have a shift operation.
- Sales screen shows/searches the original POS order number beside the sale invoice number.
- Shift Z-report data includes original order number and cash purchase details.
- Shift modal now validates `success`, reports open-order blockers, and exposes close-with-open-orders only when both permissions are present.
- Normal close no longer claims that the business day was also closed.

## Verification added

- Unit contract: `tests/unit/shiftCashPurchaseSaleTraceContract.test.ts`
- Integration: `tests/integration/shift_cash_purchase_expected.test.ts`

Expected integration equation:
`100 opening + 200 cash sale - 30 posted linked cash expense - 35 net cash purchase = 235`.\n\nAn unassigned expense (`shift_id IS NULL`) is deliberately excluded from shift cash so unrelated day/accounting rows cannot leak into a shift.

## Production status

**NOT APPLIED TO PRODUCTION.**

No migration in this repair has been run on production. Merge/deploy and production migration remain blocked until Full Verify is green and explicit approval is given.
