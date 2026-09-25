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

## Change ledger

- Added user-scoped RAM-only session-memory cache to `usePaginatedRows`.
- Added stale-while-revalidate so revisited lists keep known rows visible while Supabase refreshes in the background.
- Verified existing mutation-aware PostgREST GET dedupe and intentionally reused it instead of adding a second stale-prone dedupe layer.
- Session cache is refreshed after first-page refresh and load-more.
- `fetchAll()` explicitly bypasses display cache and reads all matching server rows in batches.
- Audited export paths; DataTable now supports an authoritative full-row provider. Customers and suppliers use full server fetch; products/purchases/expenses/inventory/reports/inventory ledger already use full-data server paths.
- Added regression tests for session reuse, user isolation, and full-server export.

## Verification ledger

- Pending.

## Production gate

State: **BLOCKED**

No Production migration planned. Merge requires exact-head Full Verify Green + explicit user approval.

## Mandatory protocol

- Check branch HEAD before every write.
- Unexpected HEAD = STOP_AND_RECONCILE.
- No parallel work.
