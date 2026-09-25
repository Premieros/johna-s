# SYSTEM CLEANUP ROOT FIXES — 2026-09-25

Repository: `Premieros/johna-s`
Base: `main@29f99187574fd700cee5da6b71d9b4b13339022c`
Branch: `development/system-cleanup-root-fixes-20260925`
Production Supabase: `azzdesuowpdcoflmyezn`

## Execution state

State: **IN PROGRESS**

## Guardrails

- Single Writer.
- No direct write to `main`.
- Check branch/main before each write; unexpected movement = STOP_AND_RECONCILE.
- No force push.
- No Production migration in this phase.
- No RLS weakening.
- Printing / Print Agent / printer routing / KDS / send-to-kitchen / shifts are frozen and out of scope.
- Historical applied migrations are append-only and are not deleted or rewritten.

## Goal

Remove dormant or duplicated application paths that can create inconsistent behavior, starting with the retired manufacturing workflow, while keeping historical database compatibility intact until a separate DB-retirement phase is explicitly approved.

## Phase ledger

### P0 — Legacy manufacturing actions fail closed
Status: **DONE**

- Removed all direct browser writes to `production_orders` from the manufacturing domain API.
- create/start/complete/cancel now delegate only to their authoritative RPC and fail closed on RPC/client errors.
- No Production database change.

Commit: `3a5c23cd4d0333c3d0c579f5e48806f587a7e154`

### P1 — Retire production application surface
Status: **IN PROGRESS**

Target:
- remove `ProductionOrdersPage`;
- remove `UnitProductionPage`;
- remove unused `ManufacturingCenterPage`;
- remove application export of the legacy manufacturing API;
- remove `catalog.produceInventoryUnit`;
- retire production-only UI permissions/guards;
- keep old route URLs as safe redirects to the reusable recipe/component surface;
- update tests/contracts so they guard the retired state instead of preserving dead UI.

### P2 — Dead/dormant code cleanup
Status: **PENDING**

- Re-prove callers before deleting dormant subscription/report/V2 wrappers.
- One small PR/commit group at a time.

### P3 — Data-source unification
Status: **PENDING**

- Inventory/finance/report authoritative reads only.
- No broad mechanical replacement of harmless lookup reads.

### P4 — Database retirement
Status: **BLOCKED / SEPARATE APPROVAL**

- Additive retirement migration only.
- No applied migration rewrite/delete.
- Full Verify + explicit approval before Production.

## Verification ledger

- Source baseline: PR #371 merged to `main@29f99187574fd700cee5da6b71d9b4b13339022c`.
- PR #371 head Verify main: Green.
- Branch verification: pending after P1 changes.

## Next action

Complete P1 application retirement, run focused source/caller proof, then open a Draft PR and run exact-head verification before any merge.
