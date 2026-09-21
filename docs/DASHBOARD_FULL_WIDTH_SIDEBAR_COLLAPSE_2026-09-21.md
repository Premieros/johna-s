# Dashboard Full-Width + Sidebar Collapse — synced on latest main — 2026-09-21

## Request
- Remove colored top/side edge lines from cards.
- Keep subtle tint only.
- Let Dashboard consume the available width instead of leaving large empty side gutters.
- Add desktop hide/show control for the sidebar.
- When hidden, expand header/content into the released space.

## Repository state
- Base: `main@e6447639486ae7fdd41342740871219797dbc9de`
- Branch: `development/dashboard-width-sidebar-collapse-sync-20260921`
- This branch was recreated from the latest main because the earlier PR #291 became stale after 152 newer main commits.

## Implementation
- `src/index.css`: removes colored pseudo-element edge/top strips; keeps faint semantic tint and neutral border.
- `src/features/dashboard/pages/DashboardDataPage.tsx`: removes duplicate horizontal padding and internal max-width; Dashboard is full width within app shell.
- `src/components/Layout.tsx`:
  - persistent desktop sidebar hidden state;
  - hide control inside sidebar;
  - restore button in header when hidden;
  - header/content offsets collapse to zero;
  - dashboard route gets `max-w-none`; other pages retain existing max width;
  - RTL/LTR logical positioning preserved.
- Unit contracts updated for tint-only cards, full-width dashboard, and collapsible sidebar.

## Safety
- UI/layout only.
- No DB migration.
- No RLS/permission changes.
- No POS business logic.
- No printing / Print Agent / KDS changes.
- All newer main work (FIFO, permissions, performance, printing updates) is preserved because this branch starts from latest main.

## Status
- Exact-head Full Verify pending before merge.
