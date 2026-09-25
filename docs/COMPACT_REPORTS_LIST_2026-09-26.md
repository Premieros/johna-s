# COMPACT REPORTS LIST — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/reports-compact-list-20260926`
Current PR: `#374`
Last updated: 2026-09-26

## Work status
State: **BLOCKED**

## Guardrails
- No direct changes to `main`.
- No Production migration in this UI simplification scope.
- Printing / Print Agent / routing / KDS / send-to-kitchen are untouched.
- Reuse existing verified report data sources; do not invent duplicate calculations.
- Keep Permission-First and history/branch visibility unchanged.
- Merge remains blocked until exact-head Full Verify Green + explicit approval.

## Baseline
- Base: `main@8ccf44caa6376b5028754cf01194e975bbba1abb`.
- Unified reporting logic is merged, but the user-facing report browser still resembles the old dashboard/card experience.
- User requirement: compact Excel-like list, one report per row, filters in the same surface, fewer overlapping reports, and master reports with broader columns.

## Root-cause ledger
1. Report discovery still uses cards, category chips, favorites and recent sections that create visual noise.
2. Operational and financial reports are visually split, forcing users to understand internal architecture.
3. Master sales report exposes too few columns, pushing users into multiple derivative reports for the same business question.

## Change ledger
- Replaced the report-card/category/favorites browser with one compact Excel-like row list.
- Operational and financial reports now share the same visible list; users no longer need to understand internal report sections.
- Added responsive behavior: persistent 240px list on desktop, single compact chooser on mobile.
- Financial report selection is synchronized from URL/list and the old financial view-button strip is hidden when embedded in the unified center.
- Expanded the main Sales report into a master invoice report with customer, user, warehouse, order type, payment method, status, subtotal, discount, tax, invoice total, paid, refunded and net collection columns.
- Added unit contract `compactReportsCenter.test.ts` to prevent regression back to cards and narrow sales output.

## Verification ledger
- Verify #2863: lint ✅, typecheck ✅; unit tests failed only in 2 stale assertions that still required the removed `ReportingShell` and old `<FinancialReportsPage />` embedding shape.
- Updated those two contracts to assert the compact unified list and `hideViewPicker` financial embedding.
- Exact-head reverify: pending.

## Production gate
- Production migration: **NOT REQUIRED / OUT OF SCOPE**.
- Merge: **BLOCKED** pending exact-head Full Verify Green + explicit approval.

## Next action
1. Replace report discovery with one compact unified row list.
2. Keep the list visible regardless of operational/financial report type.
3. Expand the master sales report with core transaction dimensions so users need fewer secondary reports.
4. Verify mobile behavior and existing permissions.

## Mandatory update protocol
- Before every repository write, verify the branch HEAD is the expected prior head.
- After every code batch, update **Change ledger**.
- After every test/workflow, update **Verification ledger**.
- Before merge, exact-head Full Verify must be Green.
