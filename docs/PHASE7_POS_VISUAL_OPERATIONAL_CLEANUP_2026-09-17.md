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
Status: IMPLEMENTED / VERIFYING

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

Regression test:
- `tests/unit/posTablesResponsiveLayout.test.ts`

Acceptance:
- No partially clipped first/last table card.
- Grid responds to available center-panel width.
- RTL and LTR both supported through the existing logical-direction shell.
- Browser smoke must remain green.

### 7C — Empty order panel / header density
Status: IN PROGRESS

Acceptance:
- Empty cart does not consume excessive operational workspace.
- Print action has a coherent disabled/hidden placement when no order exists.
- Header remains functional with lower visual density.
- Assigned-user identity remains readable on occupied tables.

### 7D — Full regression verification
Status: PENDING

- Lint
- Typecheck
- Unit tests
- Build
- DB/Integration/RLS regression (CI)
- Browser smoke
- No merge until green and explicit user approval.
