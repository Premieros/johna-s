# UI Operational Audit Recommendations — 2026-09-17

This document is advisory only. It does not change authorization contracts, RLS, routes, or database schema.

## 1. Sidebar density

### Current issue
The sidebar exposes both management centers and many underlying detail screens. This reduces the value of the centers and increases cognitive load, especially for managers and tablet users.

### Recommended operating model
Keep daily operational destinations directly visible; move low-frequency detail screens behind their center pages.

Suggested direct sidebar destinations:
- Dashboard
- POS
- KDS (permission-gated)
- Operations Center
- Inventory Center
- Procurement Center
- Waste Center
- Customers
- Suppliers
- Reports
- Approvals (permission-gated)
- Settings (permission-gated)

Suggested center/detail destinations rather than always-direct navigation:
- Inventory Ledger
- Stock Counts
- Inventory Batches
- Stock Valuation
- Low Stock Alerts
- Journal
- Treasury
- Reconciliation
- detailed procurement subflows
- infrequent catalog administration screens

### Rule
Do not remove routes or permissions. Only reduce the number of permanent sidebar entries after explicit UX approval.

## 2. Finance permission granularity

### Current issue
Several financially distinct screens are exposed from the menu under `accounts.view`, despite already having action-level permissions in the canonical permission model.

Screens currently grouped too broadly at navigation level include:
- Payments
- Journal
- Treasury
- Reconciliation
- Employee Receivables

### Existing permissions that can support a safer future split
- `accounts.view`
- `accounts.manage`
- `accounting.journal.post`
- `accounting.treasury.transfer`
- `accounting.reconciliation.manage`
- `sales.payment.receive`

### Recommendation
Introduce dedicated view permissions only if the product owner wants independent screen visibility, for example:
- `accounting.journal.view`
- `accounting.treasury.view`
- `accounting.reconciliation.view`
- `accounts.employee_receivables.view`
- `payments.view`

Do not overload action permissions such as `accounting.journal.post` merely to show a screen. View and mutation permissions should remain separate.

This recommendation requires a coordinated permission contract + migration + UI + RLS/security test change and therefore is intentionally outside this audit branch.

## 3. Permission-first UI rule

Adopt this rule consistently across the application:

> A route guard is the final security/navigation barrier, not the primary UX mechanism. A user should not normally see a CTA whose destination or operation is unavailable to them.

Apply it to:
- global header actions;
- dashboard cards;
- quick actions;
- row action menus;
- command palette results;
- keyboard shortcuts;
- mobile-only action bars.

## 4. User identity vs Settings

The user identity surface should eventually become a true account/profile menu rather than doubling as Settings navigation.

Recommended future menu entries, permission-aware:
- signed-in user identity;
- active branch/context;
- language;
- theme;
- Settings only when `settings.manage` exists;
- Sign out.

The current audit branch implements the minimum safe behavior: the identity control no longer navigates to Settings for unauthorized users.

## 5. Dashboard action semantics

Dashboard numbers should remain readable under `dashboard.view` when the backend/RLS permits the data, but destination arrows/links should exist only when the target route is available.

Implemented in this audit branch:
- report KPI links require `reports.view`;
- New Sale requires `pos.view` + `pos.order.create`;
- low-stock navigation requires `inventory.view`.

## 6. Mobile POS maintainability

The current phone adaptation depends heavily on structural CSS selectors such as `:has()`, `:first-child`, `:nth-child()` and `!important` overrides.

Recommendation for a later dedicated mobile UI refactor:
- add stable semantic `data-testid` / component-level class hooks for layout targets;
- move critical mobile layout decisions into component props/classes rather than DOM-position selectors;
- preserve desktop behavior unchanged;
- add viewport smoke coverage for 360px, 390px, 768px and desktop.

Do not mix this refactor with operational POS logic changes.

## 7. Confirmed POS immediate-state follow-up

`PosWorkspacePage.tsx` has a confirmed memo dependency mismatch in `hasUnsentItems`: it reads `kitchenSendsForActive` but does not depend on it directly.

Required in the POS-owning branch:
- dependency on `kitchenSendsForActive`;
- regression test for immediate Pay after successful kitchen send before Realtime delivery.

No stock-deduction logic should change as part of that fix.
