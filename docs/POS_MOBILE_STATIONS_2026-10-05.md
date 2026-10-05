# POS MOBILE STATIONS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/pos-mobile-stations-20261005`
Current PR: `#456`
Last updated: 2026-10-05

## Work status
State: **BLOCKED**
User explicitly requested phone-only tables/categories UI after blocked publication was resolved.
Implementation and exact-head Full Verify required.

## Guardrails
Single writer, no direct main writes, no force push. No migrations/database/permissions/RLS,
process_sale, send_to_kitchen, KDS, stock, accounting, Print Agent or printing changes.
No real sales, orders, kitchen sends or print tests. Use simulated data in tests.

## Baseline
Main db46b301d69599010c9da97e967240c363997b37. #454 journal paging and #455 asset discovery
merged. Deployment 37332715772 succeeded, including asset retention and production parity.
Unexpected main/head movement STOP_AND_RECONCILE.

## Root-cause ledger
Actual tables landing is PosTablesSidebar, not the legacy wizard. Phone headings,
two-row shortcuts and vertical spacing obscure the grid; desktop must stay unchanged.
ProductBrowser currently exposes all categories in one strip. Assignment RPC requires
settings.manage; POS readers can read branch kitchen_stations through existing RLS.
The assignment RPC constructs category_ids from categories.kitchen_station_id.

## Change ledger
Below 640px only: hide landing intro, four shortcuts in one row, tighter padding/search/filter
and grid spacing. TableCard untouched; min height 132px and touch targets retained.
Use sm overrides to preserve existing tablet/desktop dimensions.
Read only active branch stations and derive category_ids from the existing categories FK.
Render populated station cards from actual localized names; All exposes every branch category,
including categories with no station, and Back resets to cards. No hardcoded station/category
mapping and no settings permission/RPC change. Unavailable/offline stations fall back to categories.
New station read runs only on phones; scope changes remount/reset navigation and discard late
reads. Phone product rows match the selected branch; search spans products across selected
station/category. Desktop search/category rendering and product actions remain unchanged.

## Verification ledger
Focused actual component suite passed: 9 regressions (plus 6 existing render contracts).
Typecheck:all, changed-file lint and production build passed. Browser checks await CI.
Required: actual component navigation/category products/back/global search/unmapped category,
read failure/retry, scoped delayed reads, no desktop station request; viewport table spacing,
touch targets, no horizontal overflow, unchanged desktop controls/dimensions; typecheck,
unit suite, lint/build and exact-head Full Verify. Local Chromium is unavailable, so actual
viewport browser verification must pass CI before merge.

## Production gate
State: **BLOCKED**
Require exact-head Full Verify, current main reconciliation and retained previous Pages assets.
No additional database apply authorized or included.

## Next action
Complete tests, pass exact-head CI, merge/deploy approved UI scope, verify publication.

## Mandatory update protocol
Bind actual PR number and CI evidence. Record completion in PR metadata without changing
the tested head. Stop and reconcile unexpected concurrent source movement.
