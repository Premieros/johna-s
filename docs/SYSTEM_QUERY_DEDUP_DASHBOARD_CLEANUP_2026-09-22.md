# System query deduplication + dashboard cleanup — 2026-09-22

Branch: `development/system-query-dedup-dashboard-cleanup-20260922`
Base: `main`
Production DB: untouched
Migrations: none
RLS: unchanged
Printing: untouched

## Requested dashboard cleanup

Removed the dashboard cards for:
- active users;
- open shifts;
- occupied tables;
- available tables;
- open-count card that represented the open table/order activity surface;
- net sales card.

The net-sales chart and sales-derived reporting remain available; only the requested standalone card is removed.

Backing reads that existed only for the removed dashboard cards were removed as well:
- `dining_tables`;
- `shifts`;
- `users`;
- the separate duplicate sales query used only for the quick net-sales card.

## System-wide duplicate-query reduction

### 1. PostgREST request coordinator

The single Supabase client now uses a shared fetch coordinator for all PostgREST reads:
- identical concurrent GETs share one network request;
- burst-identical successful GETs reuse the same response for 1.5 seconds;
- response keys include the authorization identity and response-affecting headers;
- every PostgREST mutation/RPC invalidates the completed-read microcache immediately;
- no Auth, Storage, Realtime or mutation response is cached.

The short reuse window is deliberately not a business-data cache. It targets StrictMode/remount/effect bursts while keeping freshness bounded.

### 2. Pagination

`usePaginatedRows` previously made two requests on every initial page load: one for rows and one HEAD request for the exact count. It now obtains rows + exact count from one PostgREST response. This applies to the list/table pages using the shared hook across reporting, admin, catalog, inventory, trade, accounting, manufacturing and parties.

### 3. Shared branch source

`useBranches` now coalesces concurrent branch loads per authenticated user while keeping explicit refresh authoritative and preserving existing invalidation after branch mutations.

### 4. POS metadata

The POS workspace no longer independently fetches the global settings and active branch list. It consumes the existing `SettingsProvider` and `useBranches` data, while retaining its offline cached settings/branches as a fallback.

## Safety

- no database migration;
- no Production writes;
- no RLS or permission changes;
- no printing/print-agent/queue changes;
- no sale/payment/inventory mutation flow changes.


## Main synchronization before merge

Before merge, `main` advanced by one commit:

- `3b994c4fa20e97fd909e9ec565eeab3ac04b159a`
- title: `Fix business-day auto-close cutoff (#305)`

That change touched only:
- `docs/SHIFT_AUTO_CLOSE_CUTOFF_FIX_2026-09-22.md`;
- `supabase/migrations/20260922064500_fix_auto_close_configured_cutoff.sql`;
- `tests/integration/business_day_boundaries.test.ts`.

There was no file overlap with the query-dedup/dashboard changes. The branch was synchronized with `main` via merge commit `38ce8bb6b982f6a5b5626e0d923f835fbce263c3` without force push. PR #304 became mergeable again and the full verification workflow was restarted on the synchronized head.
