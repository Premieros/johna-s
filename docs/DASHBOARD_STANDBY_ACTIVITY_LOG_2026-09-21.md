# Dashboard StandBy Activity Bar — 2026-09-21

## Scope
Add a compact StandBy-style strip inside the dashboard only.

## Safety / identity lock
- Repository: `Premieros/johna-s`
- Base branch: `main`
- Base HEAD: `3e5a30cc264f6889a475077e35a95e69e99827a6`
- Development branch: `development/dashboard-standby-activity-20260921`
- No direct edits to `main`.
- No Production database migration.
- No printing, print queue, Print Agent, KDS routing, payment, inventory deduction, shift-close, or day-close logic changed.
- Activity display is read-only and is not in the success path of business operations.

## Implemented
- New `DashboardStandbyBar` above the dashboard period controls.
- Removed the separate welcome block; welcome + signed-in user name now live inside the StandBy strip.
- New-sale shortcut moved into the StandBy strip.
- Normal state:
  - large day number
  - weekday + month
  - compact monthly calendar
  - current day highlight
  - current branch when selected
  - notification bell
- Activity state:
  - one large activity notification at a time
  - 4.2 second display duration
  - FIFO queue for simultaneous activity
  - minimal 180ms fade/3px slide
  - reduced-motion support
  - automatically returns to calendar state
- Activity drawer:
  - latest allowed audit rows
  - unread count persisted by user + branch in localStorage
  - link to the full audit log
- Data safety:
  - reads `audit_log` only when `audit.view` is granted
  - branch filter applied client-side in addition to existing RLS
  - realtime subscription attempted for `audit_log`
  - 5-second polling fallback means no Production replication/migration is required for this phase

## Files
- `src/features/dashboard/components/DashboardStandbyBar.tsx`
- `src/features/dashboard/pages/DashboardDataPage.tsx`
- `src/features/dashboard/dashboardCompact.css`
- `tests/unit/dashboardStandbyBarContract.test.ts`

## Pending verification
- TypeScript
- ESLint
- Unit tests
- Build
- Browser visual check on desktop/mobile
- Confirm which existing audit actions provide amount/document metadata for every requested business event; missing metadata should be improved separately without changing the business transaction path.
