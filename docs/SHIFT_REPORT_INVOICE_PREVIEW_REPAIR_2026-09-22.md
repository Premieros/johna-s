# Shift report + invoice preview repair — 2026-09-22

## Scope
- Repository: `Premieros/johna-s`
- Base: `main@176501373f74a0ec1e12336095cebab7474eccdc`
- Branch: `development/shift-report-preview-repair-20260922`
- Production database was inspected read-only only.
- No migration, RLS, Print Agent, printer routing, cloud queue, KDS or send-to-kitchen change.

## Confirmed production evidence
The currently open shift `86b99616-9d5a-49dc-8ca0-3e24188b1414` has:
- 3 linked sales totaling 356.82
- 4 sale-item rows
- sold quantity 5

Its linked items are present in Production, including Tea, Flatwhite, Turkish Coffee S and Espresso D. Therefore the blank products section is not missing sales data.

## Root cause 1 — shift sold products / ingredients
`fetchShiftClosingReportServer()` is the live reader used by both the POS Shift modal and the Shifts page. The server RPC returns authoritative financial totals and sale headers, but the client adapter hard-coded:
- `orderTypes: []`
- `productsSold: []`
- `ingredientsConsumed: []`

The A4 report renders product/ingredient sections only when those arrays are non-empty, so valid Production sales were always hidden.

### Repair
- Preserve `get_shift_closing_report` as the authority for shift membership and financial totals.
- Derive order-type totals from its returned sale headers.
- Fetch sale items only for those already-authorized sale IDs.
- Aggregate sold products.
- Expand recipes branch-scoped to populate consumed ingredient/raw-material details.
- Fail explicitly on enrichment query errors instead of silently returning a false empty report.
- Added a contract test preventing the three report sections from reverting to hard-coded empty arrays.

## Root cause 2 — sales invoice preview
The screenshot error is emitted before receipt rendering:
`إعدادات الفرع غير متاحة لإنشاء المعاينة`.

`SalesPage` previously depended only on the shared in-memory `effectiveSettings(branchId)` cache. If the shared settings read was temporarily absent, invoice preview, refund preview and protected reprint all aborted even though the branch/global settings existed in Production.

Production currently contains one global settings row and two branch-settings rows, so this is not a missing-settings-data problem.

### Repair
- Keep the shared settings cache as the primary path.
- If and only if the cache is missing, perform one read-only branch-scoped recovery read of global + branch settings.
- Merge with the same canonical `mergeEffectiveSettings` helper.
- Use that resolver for customer-receipt preview, refund preview and protected reprint.
- Receipt preview remains `authorize:false`; no print authorization/queue/routing behavior was changed.

## Similar defect found in the same path
`orderTypes` was also hard-coded to an empty array in the same shift adapter. It is repaired in the same isolated change because it has the identical root cause.

## Verification plan
1. Unit contract: shift composition is no longer hard-coded empty and recipe reads stay branch-scoped.
2. Existing sales receipt contract: preview remains non-authorizing and reprint stays on the protected path.
3. New receipt-settings recovery contract.
4. Full repository CI before any merge.
5. No Production migration is required for this repair.
