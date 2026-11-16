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
