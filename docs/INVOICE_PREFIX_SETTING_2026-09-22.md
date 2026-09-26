# Per-branch sales invoice prefix — 2026-09-22

## Requested behavior
Allow an authorized user to select a branch in Settings and define a prefix for future sales invoices.

Examples:
- Branch prefix `#S` + allocated sequence 12 -> `#S12`
- Branch prefix `#C` + allocated sequence 13 -> `#C13`

## Safety contract
- Existing invoices are never renamed or updated.
- The current atomic server sequence remains the sole sequence allocator.
- The prefix is formatting only; it does not create a second counter.
- Offline pending IDs keep the existing `INV-OFF-` marker so reconciliation is not broken.
- Blank prefix preserves the existing server-generated invoice number.
- Prefix is branch-specific and limited to 12 characters.
- No printing transport, routing, queue, KDS, stock, shift, payment authorization, or receipt renderer changes.

## Storage
A nullable `public.branch_settings.invoice_prefix` column is added by:
`20260922152000_branch_sales_invoice_prefix.sql`.

The migration is committed for verification only and must not be applied to Production until Full Verify is green and explicit Production migration approval is given.

## Implementation path
- Settings UI: `SettingsControlCenterPage.tsx`
- Branch effective settings merge: `SettingsContext.tsx`
- Atomic allocation formatting: `payment.ts` + `invoiceNumber.ts`
- POS direct/settled sale paths: `usePosOrderBase.ts`, `usePosOrder.ts`

## Rollback baseline
`main@edc0512b590635a6fc694efe863bcb237bf2cbcb`
