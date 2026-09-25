# SESSION DATA PERFORMANCE — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/session-data-performance-20260925`
Current PR: `#0`
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

- Pending: add user-scoped session-memory cache to `usePaginatedRows`.
- Pending: stale-while-revalidate without hiding already displayed rows behind a loading state.
- Pending: dedupe identical in-flight first-page queries (including React StrictMode remounts).
- Pending: retain cache updates after load-more and explicit refresh.
- Pending: verify `fetchAll()` bypasses display cache and always hits the database.
- Pending: audit export paths on sales/purchases/inventory/reporting and fix any page-only export.
- Pending: regression tests for user/branch/filter isolation, revalidation, dedupe, and full export.

## Verification ledger

- Pending.

## Production gate

State: **BLOCKED**

No Production migration planned. Merge requires exact-head Full Verify Green + explicit user approval.

## Mandatory protocol

- Check branch HEAD before every write.
- Unexpected HEAD = STOP_AND_RECONCILE.
- No parallel work.
