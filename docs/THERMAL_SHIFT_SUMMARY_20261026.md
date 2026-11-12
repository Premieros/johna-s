# Compact thermal shift close
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/thermal-shift-financial-summary-20261026`
Current PR: #540
Last updated: 2026-10-26

## Work status
State: **BLOCKED**
Owner requests a financial-only compact thermal close and captain sales.

## Guardrails
No DB, reads, equations, permissions, queue/routing/idempotency, Windows-agent or A4 changes. No production test printing or log scans.

## Baseline
Main c6f01f2cb7c2395c6f79b8749c47aae1843e061f.

## Root-cause ledger
Text thermal includes all products/materials; browser thermal also lists individual invoices, expenses and purchases. Text lacks captain totals.

## Change ledger
Both thermal representations retain financial sales/payment/receivable/drawer summaries and invoice count. Add compact existing server-attributed user sales/invoice counts under Captain sales, skipping expense-only users. Do not subtract user return actions or expenses from captain sales, since these describe actor activity rather than invoice attribution. Remove product/material and verbose transaction lists. A4 remains byte-for-byte unchanged. Existing reads remain unchanged to avoid affecting shared A4/automatic-close paths.

## Verification ledger
31 focused cases, app/test types, scoped lint and whitespace checks passed. A4 generator compared byte-for-byte with baseline and unchanged. Exact-head CI pending. No physical print performed.

## Production gate
Prepare candidate with exact-head CI before production release.

## Next action
Verify and publish review candidate.

## Mandatory update protocol
Single writer; PR ledger records final CI without status-only rebuilds.
