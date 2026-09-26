# INVENTORY MODEL ALIGNMENT — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/inventory-model-alignment-20260926`
Current PR: PENDING
Base: `main@a6abe7a60e7f076f9c05222533038a5a1bc7884f`
Started: 2026-09-26 Africa/Cairo

## Work status

State: **IN PROGRESS — AUDIT/SAFE ALIGNMENT**

Goal: align the inventory/catalog user surface with the current permanent operating model without interrupting live branch operations.

## Guardrails

- Single Writer only on this branch.
- No direct write to `main`.
- Before every write, verify branch HEAD and current `main`; unexpected movement = STOP_AND_RECONCILE.
- No force push.
- No Production migration in this phase unless a separately reviewed migration becomes strictly necessary, Full Verify is Green, and explicit approval is given.
- No destructive rewrite of historical production/manufacturing data.
- No RLS weakening and no test weakening.
- Printing / Print Agent / printer routing / KDS / send-to-kitchen transport are frozen and out of scope.
- Preserve the already-merged canonical kitchen-send raw/component deduction model.
- Historical production data remains auditable.
- PR #372 is an older isolated manufacturing-retirement draft; do not write to it or merge it implicitly. Reuse only proven concepts after reconciling with latest `main`.

## Permanent operating model

- Sellable product = a named collection of direct raw components and/or reusable named component groups.
- No pre-manufacturing or finished-product stock is required before sale.
- Kitchen send is the authoritative inventory deduction point.
- Raw-material stock is warehouse-aware operationally via raw batches/FIFO.
- Raw stock may go negative according to current canonical rules.
- Void/refund reverses the exact stored kitchen-send snapshot.
- User-facing stock transfer is raw-material transfer, not finished-product transfer.
- Legacy production history may remain in the database for audit compatibility, but must not drive current UI behavior.

## Confirmed drift / root-cause ledger

1. `TransfersPage` still exposes `product | raw_material`, requires a second destination item field, and blocks same-branch raw transfer using obsolete branch-level-stock wording.
2. `InventoryPage` still presents finished-product `inventory` as the main stock surface, including Ready/Component/Manufactured labels.
3. `InventoryBatchesPage` still manages finished-product batches and exposes `production` as a source.
4. `InventoryUnitsPage`, `ProductSetupWizardPage`, and `PricingPage` still use `unit_type='manufactured'` language/filters even though these units now represent reusable component groups.
5. Legacy production application code still exists on current `main` even though old production routes redirect away from it. PR #372 attempted retirement from an older base and is now stale/non-mergeable.
6. Reporting and permissions still contain manufacturing-era labels; reporting is sensitive because recent report rebuilds exist and must be reconciled before writes.

## Execution phases

### P0 — Safety and contract audit
- Reconcile current `main`, open PRs, and current database/runtime contracts.
- Identify exact UI/API/tests that can be corrected without Production DDL.
- Add regression guards before broad deletion.

### P1 — Raw-material transfer correction
- Make transfer creation raw-material-only in current UI.
- Remove finished-product transfer choice from user-facing flow.
- Replace the confusing duplicate source/destination raw-material fields with one user-facing raw selection.
- Resolve destination identity deterministically and safely.
- Remove the obsolete same-branch prohibition only if current RPC/database contract proves warehouse-aware raw transfer is valid.
- Preserve permissions, branch isolation, approval flow, FIFO costing, audit log, and historical transfers.

### P2 — Inventory surface alignment
- Reframe the primary inventory screen around raw-material warehouse balances.
- Prevent finished-product stock concepts from being presented as current operational truth.
- Align batch/FIFO UI with raw-material batches where safe.
- Do not delete historical finished-product inventory data.

### P3 — Component-group terminology
- Rename manufactured-unit concepts in current UI to reusable component groups.
- Keep underlying legacy schema names temporarily where changing schema would add risk.
- Ensure product setup and pricing use the canonical component resolver/source.

### P4 — Legacy production application retirement
- Reconcile and port only the safe, current-main-compatible subset of PR #372.
- Remove unused production-order/unit-production UI/API from runtime.
- Keep legacy URLs as safe redirects.
- Preserve historical DB objects until separate database-retirement approval.

### P5 — Reports/permissions/tests cleanup
- Reconcile with latest report rebuild before changing report labels/categories.
- Retire production-only application permissions only after caller proof.
- Update tests so they guard the current operating model instead of preserving legacy manufacturing behavior.

## Change ledger

- Created this isolated branch from latest merged `main@a6abe7a60e7f076f9c05222533038a5a1bc7884f`.
- Read-only audit completed before first application change.
- No Production database writes performed.
- No printing/KDS/send-to-kitchen code modified.

## Verification ledger

- Pending first code batch.
- Required before merge: lint, typecheck, unit, build, fresh DB/schema, integration/security/RLS, Browser Smoke, exact-head Full Verify.

## Production gate

State: **BLOCKED**

- No Production migration authorized.
- No Production data mutation authorized.
- Merge blocked until exact-head Full Verify Green and explicit approval.

## Next action

Implement P1 only: correct the transfer screen/API contract on this branch after verifying the latest transfer RPC and warehouse-aware raw-material behavior. Stop before any Production migration or merge.
