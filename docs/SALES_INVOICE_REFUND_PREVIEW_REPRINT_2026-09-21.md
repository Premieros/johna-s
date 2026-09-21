# Sales Invoice Refund / Preview / Reprint — 2026-09-21

## Baseline
- main: `0559ec7e0bc21524cc029bc00055928837a7cd6d`
- branch: `development/sales-invoice-refund-preview-reprint-20260921`

## User-requested scope
From Sales Invoices:
- preview the completed customer receipt;
- reprint the completed customer receipt;
- refund one item or a chosen quantity from a completed/paid sale;
- refund all remaining refundable items in one action;
- preview the refund selection in a receipt-style 80mm view before execution;
- expose mutation actions only through existing permissions.

## Safety boundaries
- No Production migration.
- No new refund/accounting/inventory implementation: continue using the existing authoritative `process_refund` workflow.
- No changes to Print Agent, printer stations, queue RPCs, or receipt authorization.
- Customer receipt preview calls `buildReceiptHtml(..., { authorize: false })`, so preview cannot create a print event, consume a reprint approval, or enqueue a print job.
- Reprint continues through the existing `authorize_sale_print` + cloud receipt path and preserves print-once / controlled-reprint behavior.
- Refund editor starts all quantities at zero. Full refund requires an explicit user action.

## Permission mapping
- view/preview: `sales.view`
- refund initiation: `sales.refund.create`
- direct refund execution: `refunds.approve`
- payment-method editing: `sales.payment.receive` (or approval-capable management)
- customer receipt print: `pos.receipt.print`
- direct receipt reprint: `pos.reprint`; otherwise the existing manager-approval path remains active.

## Verification
Pending focused tests + Full Verify before merge.
