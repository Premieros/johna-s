# POS tables full-width landing — 2026-11-16

Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

Branch: `fix/pos-tables-full-width-landing-20261116`
Base: `af560118aeaf77fa421f5dddb20cb21ac790849b`
User scope: Table area is a browsing/selection screen, not a split sale/cart workspace. When on table landing, hide unused catalog and cart on desktop, give tables full width; order type buttons (quick, delivery, drive-thru, online) and active orders should sit alongside table controls. When a real order is started/resumed, return to current catalog/cart/pay layout. Preserve permission-first gates, branch opt-in on online, active orders and mobile layout.

## Evidence
- `PosWorkspacePage.tsx` always renders `PosTablesSidebar`, catalog, and desktop `lg:flex` 380–440px empty cart side panel.
- `PosTablesSidebar.tsx` displays table picker's quick/delivery/drive-through/active-order actions, but not online, with `w-[calc(100vw-380px)]` table width. It returns null after table selection, active order, or `pos:order-flow-started`.
- `OrderStartWizard.tsx` has online action, yet sidebar table selection route does not show it. Online settings enabled state is already read in workspace.
- No requested database or financial changes.

## Guards
- No auto-activation of Online, no new business records, no changes to pricing or branch taxes.
- Empty checkout/cart never covers table landing; order cart, payment and controls remain reachable when editing a genuine order.
- Do not merge until full exact-head CI is green; production GitHub Pages publication must be separately verified.

## Implementation
- The tables landing is now full viewport width and does not render catalog, current cart or payment side panel until a real order is started or resumed.
- Online is a fifth compact action in the table landing header, adjacent to Quick, Delivery, Drive Thru and Active Orders. Its button is available only to users with pos.order.online and is disabled until the branch pricing setting is enabled.
- Clicking Online follows the same direct flow as Quick: it marks the tables picker as completed and immediately opens products + cart with order_type online, without requiring a table, customer or external platform selection.
- New Order resets to the full-width table landing; opening an existing table/order retains the prior order/cart/checkout behavior.
- Added Playwright regression for desktop full width, no idle cart, direct Online start and reset. Existing phone single-row action geometry contract preserved with five-column layout.
- No SQL migrations, pricing changes, role grants, external APIs or business data edits.

## Verification
- CI pending on final exact head. No merge or Pages release asserted.

## First CI regression and correction
Verify run 43894206051: the new desktop 1280px full-width/no-cart/Online-direct-start Playwright test **passed**. The existing 320px phone geometry test failed: five actions wrapped to a second row because `src/mobile-layer-fix.css` had an older `@media(max-width:639px)` four-column `!important` override, despite five-column JSX. Adjusted only this mobile override from four to five columns; kept the existing 44px touch target and one-row contract. Fresh exact-head Full Verify required before release.
