# Thermal Receipt & Z-Report Readability Fix — 2026-09-18

Branch: `development/thermal-receipt-zreport-readable-20260918`
Base: `8ef8a90ba54c60b8204fc9e95774d2a86ab35be5`

## Production evidence

- Current paid receipt cloud jobs are already text-only, but mixed Arabic/Latin numerals and labels make thermal output hard to read.
- Older Z-report jobs were HTML-only and therefore printed CSS literally through the legacy localhost text service.
- Newer Z-report jobs are text-only, but the thermal report still prints every invoice and tender line, producing an excessively long and hard-to-read slip.
- Open-order customer checks still had an HTML-only cloud queue path.

## Fix

- Payment receipts use printer-stable thermal text: ASCII numeric/date formatting, EGP suffix, explicit item arithmetic and payment-method labels.
- Normal and split tender allocations are carried into the printed payment receipt.
- Open checks from both POS paths are queued to the cashier station as text.
- Thermal Z-report is a concise operational summary; detailed invoices remain in the A4 report.
- Browser cloud agent and localhost compatibility path strip HTML before text transport.
- A database queue-boundary trigger normalizes any cached/legacy receipt/report HTML to text before durable queue insertion.
- Only pending/failed legacy jobs are normalized in-place; submitted jobs are never replayed or mutated.

## Safety

- No printer route changes.
- No Windows/Electron reinstall required.
- No RLS weakening.
- No role-name authorization.
- Print authorization and print-once rules are unchanged.
- Production migration must not be applied until Full Verify is green and explicit Production approval is given.
