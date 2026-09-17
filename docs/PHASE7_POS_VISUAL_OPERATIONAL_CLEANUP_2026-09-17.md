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
Status: IMPLEMENTED / VERIFYING

Behavior:
- System DB language/theme remain defaults only until the user explicitly chooses a value.
- Explicit language selection is persisted using `pos_lang` plus an explicit preference lock.
- Explicit Light/Dark selection or toggle is persisted using `pos_theme` plus an explicit preference lock.
- Settings refresh no longer overwrites locked preferences.
- No schema, RLS, permission, or Production change.

Regression test:
- `tests/unit/uiPreferencePersistence.test.ts`

### 7B — Table grid clipping and responsive width
Status: PENDING

Acceptance:
- No partially clipped first/last table card.
- Grid responds to available center-panel width.
- RTL and LTR both supported.
- Verify desktop 1920/1366 and tablet widths.

### 7C — Empty order panel / header density
Status: PENDING

Acceptance:
- Empty cart does not consume excessive operational workspace.
- Print action has a coherent disabled/hidden placement when no order exists.
- Header remains functional with lower visual density.

### 7D — Full regression verification
Status: PENDING

- Lint
- Typecheck
- Unit tests
- Build
- DB/Integration/RLS regression (CI)
- Browser smoke
- No merge until green and explicit user approval.
