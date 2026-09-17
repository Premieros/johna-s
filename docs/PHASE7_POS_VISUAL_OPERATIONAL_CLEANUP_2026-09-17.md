# Phase 7 — POS Visual Operational Cleanup — 2026-09-17

## Identity
- Repository: `Premieros/johna-s`
- Baseline `main`: `d474d35bd4f8e80c247ae8bdf3480fd7b317c5ae`
- Working branch: `development/phase7-pos-visual-preferences-20260917`
- Production DB changes: NONE
- Migrations: NONE
- Printing logic changes: NONE

## Scope from operational screenshot review
1. Fix clipped/cropped table cards at viewport edges.
2. Make table grid fit the real available width instead of overflowing behind/against the order panel.
3. Improve empty-order panel space usage without changing order logic.
4. Reduce header crowding without removing operational status.
5. Keep assigned-user identity readable on occupied table cards.
6. Keep Arabic/English direction behavior correct.
7. Allow explicit language selection and persist it.
8. Allow explicit Light/Dark theme selection and persist it.
9. Once language/theme are explicitly selected, Settings refresh must not overwrite them.

## Stages

### 7A — Language and theme persistence
Status: COMPLETE / CI GREEN

Behavior:
- System DB language/theme remain defaults only until the user explicitly chooses a value.
- Explicit language selection is persisted using `pos_lang` plus an explicit preference lock.
- Explicit Light/Dark selection or toggle is persisted using `pos_theme` plus an explicit preference lock.
- Settings refresh no longer overwrites locked preferences.
- No schema, RLS, permission, or Production change.

Regression test:
- `tests/unit/uiPreferencePersistence.test.ts`

Verification run:
- GitHub Actions `Verify main` run #1669: verify ✅, db/integration/RLS ✅, browser smoke ✅.

### 7B — Table grid clipping and responsive width
Status: COMPLETE / CI GREEN

Root cause confirmed:
- Tables landing reserved `100vw` while the desktop order panel simultaneously reserved 380/410/440px.
- The split workspace uses `overflow-hidden`, so the excess width clipped table cards at the viewport edge.

Implemented:
- Removed `min-w-[100vw]` from the tables workspace.
- At desktop widths the tables workspace now subtracts the exact visible order-panel width:
  - `lg`: `calc(100vw - 380px)`
  - `xl`: `calc(100vw - 410px)`
  - `2xl`: `calc(100vw - 440px)`
- Replaced fixed 6/8/10-column desktop grid with `auto-fit` + `minmax(150px, 1fr)` so columns adapt to actual available width.
- Added stable `data-testid="pos-table-grid"`.
- Occupied-table operator identity is displayed in its own readable row.

Regression tests:
- `tests/unit/posTablesResponsiveLayout.test.ts`
- `tests/unit/posHeaderAndOperatorVisualContract.test.ts`

Verification run:
- GitHub Actions `Verify main` run #1676: verify ✅, db/integration/RLS ✅, browser smoke ✅.

### 7C — Empty order panel / header density
Status: IMPLEMENTED / VERIFYING

Implemented:
- Empty cart is now a compact dashed card instead of a full-height centered void.
- Empty state exposes an explicit Add item action using the existing item-focus callback.
- Discount controls and subtotal/discount/total footer are hidden while the cart is empty.
- Print is hidden until there is a sent, printable receipt instead of appearing as a disabled floating action.
- Header counters remain functional but use compact icon + count presentation.
- Online/time/user detail move to wider breakpoints to reduce desktop crowding.
- No print execution path, order logic, stock logic, permission contract, RLS, schema, or Production behavior changed.

Regression test:
- `tests/unit/posEmptyCartVisualContract.test.ts`

### 7D — Full regression verification
Status: PENDING FINAL HEAD VERIFICATION

Required on final HEAD:
- Lint
- Typecheck
- Unit tests
- Build
- DB/Integration/RLS regression (CI)
- Browser smoke
- No merge until green and explicit user approval.
