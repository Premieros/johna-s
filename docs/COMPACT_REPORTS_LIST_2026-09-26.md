# COMPACT REPORTS LIST — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/reports-compact-list-20260926`
Current PR: `TBD`
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
- Pending.

## Verification ledger
- Pending.

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
