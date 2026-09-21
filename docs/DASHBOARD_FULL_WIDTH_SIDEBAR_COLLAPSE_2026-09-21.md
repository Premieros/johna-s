# Dashboard Full-Width + Sidebar Collapse — 2026-09-21

## User feedback
Based on the live Dashboard screenshot:
1. Remove the colored edge/top lines from cards.
2. Keep surfaces visually separated without harsh white/black pages.
3. Let the new Dashboard center fill the unused horizontal space.
4. Add a desktop button to hide/show the side navigation.
5. When the sidebar is hidden, content must expand into its space.

## Repository state
- Repository: `Premieros/johna-s`
- Base: `main@320413ed08a037c25d57a05c26e777a9e97da018`
- Branch: `development/dashboard-width-sidebar-collapse-20260921`

## Implementation

### Card styling
`src/index.css`
- Removed the `::before` colored edge/top strip renderers.
- Semantic accent classes remain, but now only provide a very faint background tint.
- Standard neutral border remains the card boundary.
- No colored line is rendered on the card edge or top.

### Dashboard width
`src/features/dashboard/pages/DashboardDataPage.tsx`
- Removed the Dashboard's duplicate horizontal padding.
- Removed its internal `max-w-[1560px]` wrapper.
- Dashboard now uses `w-full min-w-0` and fills the shared content region.
- Vertical spacing was tightened slightly without changing data/behavior.

`src/components/Layout.tsx`
- Dashboard route uses `max-w-none` in the shared content surface.
- Other pages retain the existing `max-w-[1600px]` contract.

### Desktop sidebar hide/show
`src/components/Layout.tsx`
- Added `desktop-sidebar-hide` inside the desktop sidebar header.
- After hiding, `desktop-sidebar-toggle` appears in the app header to restore the sidebar.
- Desktop sidebar can be hidden and shown without affecting mobile behavior.
- Header logical start offset changes from 260px to 0 when hidden.
- Main content logical start margin changes from 260px to 0 when hidden.
- Sidebar itself slides fully outside the viewport in RTL or LTR as appropriate.
- State persists in localStorage:
  `premier:desktop-sidebar-hidden`.
- RTL uses logical positioning; no hard-coded left/right layout dependency was introduced.

## Safety
- Presentation/layout only.
- No DB migration.
- No RLS/permissions changes.
- No sales/POS transaction/payment/inventory/accounting logic changes.
- No printing / Print Agent / KDS changes.
- Mobile sidebar behavior remains unchanged.

## Tests
Updated:
- `tests/unit/uiSurfaceAccentContract.test.ts`
  - semantic tint remains;
  - colored pseudo-edge strips are forbidden;
  - Dashboard full-width contract is pinned.
- `tests/unit/sidebar-direction.test.ts`
  - desktop hide/show offset and persisted state pinned.
- `tests/unit/navigationRegression.test.ts`
  - logical RTL/LTR shell contract updated for collapsible sidebar.

## Status
Implementation complete on development branch.
Full Verify pending before merge.
