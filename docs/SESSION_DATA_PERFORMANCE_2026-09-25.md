# SESSION DATA PERFORMANCE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/session-data-performance-20260925`
Current PR: `#371`
Base: `main@3d5dd1fcd20e933f9dd8148b5a196ed6f415de9e`
Last updated: 2026-09-25

## Work status

State: **BLOCKED**

Frontend performance work only. Merge is blocked until exact-head Full Verify Green and explicit approval.

## Goal

Make common pages feel near-instant while preserving server truth:
- session-memory cache only (no localStorage/IndexedDB for operational pages);
- stale-while-revalidate for previously visited filtered lists;
- request deduplication for identical in-flight list queries;
- bounded server pagination remains authoritative;
- export always fetches all matching rows directly from the database, never from display cache;
- keep branch/user/filter/history scopes isolated.

## Guardrails

- Single Writer only.
- No direct write to `main`.
- No force push.
- No Production migration in this phase.
- No printing / Print Agent / KDS / shift-flow changes.
- No weakening RLS/history/permissions.
- Browser-persistent cache is not introduced for sales, purchases, treasury, reports, inventory lists.

## Baseline

- Route chunk prefetch and POS cache-first improvements are already merged in PR #370.
- `usePaginatedRows` currently serves at least 27 list pages with bounded first-page requests.
- `fetchAll()` in `usePaginatedRows` reads all matching rows directly from Supabase in batches and is used by several exports.
- Reports use `fetchAllReportRows` for full-dataset export/report loading.
- Inventory ledger export already walks the full cursor-paginated result set.

## Root-cause ledger

1. List pages backed by `usePaginatedRows` always start empty after navigation/remount and wait for the first server round-trip before showing rows.
2. The application already has mutation-aware PostgREST GET dedupe, so duplicate-read suppression must reuse that layer instead of adding a second in-hook dedupe.
3. Display pagination is intentionally bounded, but exports must bypass display state/cache and fetch every matching server row.
4. Some DataTable exports previously had access only to currently loaded rows, which could produce incomplete files.
5. Browser-persistent caching is not appropriate for operational finance/trade lists; session RAM is the safe acceleration layer.

## Change ledger

- Added user-scoped RAM-only session-memory cache to `usePaginatedRows`.
- Added stale-while-revalidate so revisited lists keep known rows visible while Supabase refreshes in the background.
- Verified existing mutation-aware PostgREST GET dedupe and intentionally reused it instead of adding a second stale-prone dedupe layer.
- Session cache is refreshed after first-page refresh and load-more.
- `fetchAll()` explicitly bypasses display cache and reads all matching server rows in batches.
- Audited export paths; DataTable now supports an authoritative full-row provider. Customers and suppliers use full server fetch; products/purchases/expenses/inventory/reports/inventory ledger already use full-data server paths.
- Added regression tests for session reuse, user isolation, and full-server export.
- Sales page no longer preloads all customers on first paint; branch customers load only when an editable sale is opened.
- Products page no longer aggregates stock components on first paint; aggregation starts on edit intent in parallel with edit metadata.
- Reports page now fetches only metadata dimensions required by the active report instead of seven lists on every open.
- Added source-contract tests to prevent regression to eager first-open loading.

## Verification ledger

- Verify #2801 on `f8da4ac71920a1306ee3d62be14f99ba01668c4b`: Full Green (verify/db/browser-smoke).
- New first-open optimizations added after #2801; exact-head Full Verify pending.

## Next action

Run exact-head Full Verify on the current PR #371 head. If Green, review remaining high-cost first-open queries and stop before merge for explicit approval.

## Production gate

State: **BLOCKED**

No Production migration planned. Merge requires exact-head Full Verify Green + explicit user approval.

## Mandatory update protocol

- Check branch HEAD before every write.
- Unexpected HEAD = STOP_AND_RECONCILE.
- No parallel work.
