# UI Surface Accent & Typography Plan — 2026-09-21

> **Live execution log.** This file is the implementation record for the visual surface/accent work and must be updated after every phase before merge.

## Identity / Safety Lock

- Repository: `Premieros/johna-s`
- Base at start: `main@ff2152b8f9849e9c03376fb69d87c83432f795d3`
- Development branch: `development/ui-surface-accent-20260921`
- Scope: **visual hierarchy, surfaces, card/section accents, typography readability only**.
- No direct edits to `main`.
- No Force Push.
- No Production migration.
- No RLS / permission changes.
- No sales, purchasing, inventory deduction, accounting, shift/day-close business logic changes.
- Printing / Print Agent / cloud print queue / KDS / send-to-kitchen remain frozen and untouched.
- The StandBy strip remains a separate intentional black feature; this work must not flatten or recolor it into the page surface system.

---

## User Goal

Reduce the harshness of:
- pure bright-white pages in Light mode;
- heavy pure-black pages in Dark mode;

while making the system easier to scan by using **subtle color strips / borders / tinted surfaces** to separate sections, cards, filters, tables and information groups.

The page must remain professional and calm: color is used for hierarchy, not decoration.

### Visual rule

**90% neutral comfortable surfaces + 10% semantic/accent color.**

No page should become a mosaic of strong colors.

---

# Design Direction

## Light mode

Target:
- page background: soft off-white / cool neutral, not pure white;
- cards: slightly warmer/brighter than page background;
- raised controls: a second subtle neutral level;
- borders: visible but low contrast;
- accent strips: 3–4 px, vivid enough to scan but not dominant.

Initial target values to validate visually:
- Page: approximately `#F5F7FA`
- Surface: approximately `#FCFCFD`
- Raised surface: approximately `#F8FAFC`
- Alternate strip/filter surface: approximately `#EEF2F7`

## Dark mode

Target:
- page background: soft charcoal, not absolute black;
- cards: one clearly visible elevation step above page;
- raised controls: another subtle elevation step;
- borders: visible on charcoal without glowing;
- accents: slightly brighter than Light mode so data remains legible.

Initial target values to validate visually:
- Page: approximately `#111318`
- Surface: approximately `#181B21`
- Raised surface: approximately `#20242C`
- Alternate strip/filter surface: approximately `#151820`

**Exception:** the Dashboard StandBy strip intentionally stays true black because it is a focused display surface.

---

# Accent System

Accent is applied as a **thin top strip or logical-side strip (RTL-aware)** plus an optional 3–6% tinted surface.

Initial semantic mapping:

| Domain / usage | Accent | Purpose |
| --- | --- | --- |
| Sales / primary operational | Blue | primary activity and sales |
| Purchases / procurement | Amber | purchases and supplier activity |
| Inventory / warehouse | Emerald | stock and warehouse |
| Accounting / finance | Violet | financial/accounting surfaces |
| Alerts / exceptions / voids | Rose | warnings, exceptions, destructive activity |
| Settings / system / utilities | Cyan | configuration and system surfaces |
| Neutral / generic | Slate/brand | sections without a semantic domain |

Rules:
1. Do not color every control.
2. One section/card gets one accent.
3. Accent must never be the only carrier of meaning; icon/title/text remain readable.
4. Tables use accent mainly in the **header/section edge**, not every row.
5. Filters/toolbars use a subtle tinted header/edge, not a fully colored block.
6. Destructive red/rose is reserved for destructive/exception states.

---

# Typography Contract

## Font family

The existing system already defines:
- **Arabic / RTL:** `Cairo`
- **English / LTR:** `Inter`
- Fallback: `system-ui`, platform sans-serif

This work will **standardize use of the existing font stack**; it will not introduce a new remote font dependency in Phase 1.

### RTL
`font-family: 'Cairo', 'Inter', system-ui, -apple-system, sans-serif;`

### LTR
`font-family: 'Inter', 'Cairo', system-ui, -apple-system, sans-serif;`

## Weight policy

- 400: secondary long-form/supporting text only.
- 500: normal data/body/table cells.
- 600: labels, field names, secondary actions.
- 700: buttons, table headers, section labels.
- 800: page titles, important card titles, KPI values.
- 900: exceptional display values only; avoid as a general UI weight.

## Size / line-height policy

| Usage | Target size | Weight | Line height |
| --- | ---: | ---: | ---: |
| Page title | 24–28 px | 800 | 1.25–1.35 |
| Section title | 16–18 px | 700/800 | 1.35–1.45 |
| Card title | 14–16 px | 700 | 1.4–1.5 |
| Body / form data | 14–15 px | 500 | Arabic 1.6 / English 1.5 |
| Table header | 12–13 px | 700 | 1.4 |
| Table body | 13–14 px | 500 | 1.5 |
| Labels / metadata | 12–13 px | 600 | 1.45 |
| Buttons | 13–14 px | 700 | 1.3–1.4 |
| KPI / large numeric value | 24–32 px | 800 | 1.15–1.25 |

## Numeric readability

- Financial/KPI/table numbers should use `tabular-nums` where practical.
- Amounts must not rely on low-contrast muted colors.
- Avoid clipping currency, invoice numbers, branch names or employee names.

## Text clipping policy

- Do **not** use `truncate` for important identity/data when wrapping is acceptable.
- Important names/titles: `min-width: 0` + safe wrapping.
- Ellipsis remains acceptable only for dense navigation/table cells when the full value is reachable by tooltip/detail view.
- Arabic controls must be tested for glyph height and line-height; no fixed-height container may cut Arabic diacritics/glyphs.

---

# Implementation Plan

## Phase 0 — Baseline & inventory
**Status: COMPLETE**

- [x] Start from latest `main`.
- [x] Create isolated development branch.
- [x] Inspect existing global design tokens in `src/index.css`.
- [x] Confirm typography stack: Inter/Cairo.
- [x] Inventory shared surfaces/cards/filter bars/table shells that can safely inherit global styling.
- [x] Identify components where a global token change could cause operational regression.

Deliverable:
- component impact list;
- no UI behavior changes yet.

### Phase 0 inventory findings

**Safe shared leverage points**
- `src/index.css`: global page/surface/border/text tokens and typography stack.
- `src/components/PageHeader.tsx`: shared `Card` and `StatCard`.
- `src/components/design/DesignSurface.tsx`: shared `DesignFilterBar`.
- `src/components/design/CenterTile.tsx`: shared navigation tiles/cards.
- `src/components/DataTable.tsx`: shared table/filter menu surface.
- reporting shells/filter cards already use `bg-ui-surface` + `border-ui-border` and can inherit token improvements.

**Local card implementations requiring later normalization**
- `src/features/dashboard/pages/DashboardDataPage.tsx`
- `src/features/dashboard/pages/DashboardExecutiveInsightsV2.tsx`
- `src/features/dashboard/pages/VisualDashboardPage.tsx`

These duplicate local Card patterns and should be handled after the shared token/primitives are stable, not by broad string replacement.

**Operational/high-risk surfaces to exclude from the first visual pass**
- POS payment/start/table operational controls;
- kitchen display cards;
- printer settings / print agent related controls;
- modal flows tied to void/transfer/payment.

Reason: these screens have touch-layout/status semantics and must receive visual accents only in a later focused regression pass.

## Phase 1 — Global surface tokens
**Status: COMPLETE**

Planned files:
- `src/index.css`
- `tailwind.config.js` only if new reusable semantic tokens are required.

Tasks:
- soften Light page/surface levels;
- move Dark page from absolute black to charcoal hierarchy;
- keep high contrast text;
- add reusable accent-strip/tinted-surface variables/classes;
- preserve the true-black StandBy exception.

Acceptance:
- no pure-white full-page glare;
- no full-page crushed black;
- card boundaries remain visible in both modes;
- WCAG-friendly readable text contrast.

## Phase 2 — Shared card / section primitives
**Status: COMPLETE**

Targets:
- shared Card/surface primitive(s);
- Stat/KPI cards;
- Design surface/filter bars;
- report shells;
- common table containers.

Tasks:
- introduce 3–4 px accent edge/strip;
- use RTL logical edge where appropriate;
- add light semantic tint only where useful;
- standardize title typography.

Acceptance:
- one shared implementation drives many pages;
- no page-by-page duplicate CSS where a shared primitive exists.

## Phase 3 — Tables, filters and information strips
**Status: COMPLETE**

- distinguish table header from page surface;
- add subtle section strip on filter/tool bars;
- preserve dense row readability;
- no rainbow rows;
- keep hover/selected states separate from domain accent.

## Phase 4 — Page rollout
**Status: COMPLETE (safe rollout scope)**

Order:
1. Dashboard cards below the StandBy strip. ✅
2. Inventory / warehouse. ✅ first safe center/shared pass
3. Purchases. ✅ search/table surfaces
4. Accounting / finance. ✅ treasury + financial-report filter surfaces
5. Reports. ✅ browser/filter/cards by report category
6. Settings / admin surfaces. ✅ users/branches/approval shared panels
7. Remaining shared pages. ✅ inherit the shared neutral Card/DataTable/DesignPanel strip by default; no local semantic override added without a clear domain need.

POS operational workspace is reviewed separately after shared primitives are stable so visual work cannot disturb touch layout or critical controls.

## Phase 5 — Responsive + RTL typography
**Status: IN PROGRESS — automated smoke green; manual visual review still required**

Test:
- 360/390/430 px mobile;
- tablet;
- desktop;
- Arabic and English;
- Light and Dark;
- long user/branch/product names;
- financial amounts and table headers.

Acceptance:
- no clipped Arabic text;
- no accidental horizontal page scroll;
- accent edges follow RTL correctly;
- touch targets remain unchanged or improved.

## Phase 6 — Regression / Verify
**Status: GREEN on implementation head; final docs-head rerun pending**

Required before merge:
- Lint
- TypeScript
- application/test suite typecheck
- Unit
- Build
- DB schema/integration/security regression (must remain unchanged/green)
- Browser Smoke
- visual review Light/Dark + Arabic/English + mobile/desktop

No merge until exact-head Full Verify is green and latest `main` is rechecked.

---

# Files Changed So Far

- `docs/UI_SURFACE_ACCENT_PLAN_2026-09-21.md` — live plan/execution log.
- `docs/CURRENT_WORK_PLAN.md` — active visual work pointer/status.
- `src/index.css` — softened Light/Dark surfaces, semantic accent-strip tokens/classes, tabular-number table rule.
- `src/components/PageHeader.tsx` — shared Card/StatCard accents + typography normalization.
- `src/components/design/DesignSurface.tsx` — system-accent filter bar.
- `src/components/design/CenterTile.tsx` — accent strip + stronger title/body typography.
- `src/components/design/DesignPanel.tsx` — normalized shared panel typography.
- `src/components/DataTable.tsx` — table/filter accent treatment + stronger header/body typography.
- `src/features/dashboard/pages/DashboardDataPage.tsx` — first semantic accent rollout below the StandBy strip.
- `tests/unit/uiSurfaceAccentContract.test.ts` — contract for neutral surfaces, accents, typography and StandBy exception.

---

# Execution Log

### 2026-09-21 — Initialization
- Base confirmed: `main@ff2152b8f9849e9c03376fb69d87c83432f795d3`.
- Created branch: `development/ui-surface-accent-20260921`.
- Existing global surface tokens inspected.
- Existing typography confirmed as Cairo for RTL and Inter for LTR.
- User requirement added explicitly: font family, weights, sizes, line-height and clipping policy are part of acceptance, not an incidental styling choice.

### 2026-09-21 — Phase 0 inventory complete
- Shared leverage points identified: global tokens, PageHeader Card/StatCard, DesignFilterBar, CenterTile and DataTable surfaces.
- Duplicate local dashboard Card implementations identified for later normalization.
- POS operational, payment, kitchen and printing-adjacent surfaces explicitly excluded from the first pass.
- No runtime/UI code changed yet.
- Next action: Phase 1 — adjust global neutral surfaces and add reusable accent-strip primitives while preserving StandBy true black.


### 2026-09-21 — Phase 1 complete / Phase 2 first pass
- Light mode full-page white glare reduced using layered off-white/cool-neutral tokens.
- Dark mode page moved from absolute black to charcoal hierarchy; cards remain visibly elevated.
- StandBy strip explicitly remains true black.
- Added RTL-aware 3px logical-side accent strip and optional top strip.
- Added semantic accent families: primary/sales, purchase, inventory, finance, alert and system.
- Shared Card/StatCard, DesignFilterBar, CenterTile, DesignPanel and DataTable received the first safe accent/typography pass.
- Dashboard cards below StandBy now use semantic strips (sales blue, finance violet, inventory emerald, alerts rose, utilities cyan/neutral).
- Financial/KPI/table numbers use tabular numeric behavior where practical.
- Added `uiSurfaceAccentContract.test.ts`.
- No printing, POS transaction logic, DB, RLS or permissions changed.
- Next: run Full Verify on this exact branch head. If green, continue Phase 2/3 rollout only through safe shared/report/inventory/purchase/accounting surfaces, then visual regression before merge.


### 2026-09-21 — Verify run #2104
- Lint ✅
- TypeScript ✅
- Application/test-suite typecheck ✅
- Unit: 835 passed / 1 failed.
- Failure was an obsolete visual contract in `darkBlackPosContrastContract.test.ts` that explicitly required `--ui-page: 0 0 0` and true-black global dark surfaces.
- This expectation conflicts with the newly approved UI requirement: pages must not be crushed black.
- Updated the contract to require charcoal page/surface hierarchy while preserving true black only for the Dashboard StandBy strip.
- No production/business behavior was changed to satisfy the test; only the superseded visual expectation was updated.
- New verification run triggered from commit `b72ff8486e3b8f2f294cd56283998f51994379c1`.


### 2026-09-21 — Exact repository re-check before continuation
- Re-read live GitHub state instead of relying on conversation memory.
- `main` confirmed unchanged at `ff2152b8f9849e9c03376fb69d87c83432f795d3`.
- PR #287 confirmed OPEN / mergeable / not merged.
- PR head at re-check: `330969d2ab02867c9cb35db68c634d2a43eafec1`.
- Verify run #2107 confirmed **Full Green**:
  - lint ✅
  - TypeScript ✅
  - application/test-suite typecheck ✅
  - unit ✅
  - build ✅
  - canonical migrations + schema ✅
  - integration + security/RLS ✅
  - Browser Smoke / Playwright ✅
- Continued only after this exact-state verification.

### 2026-09-21 — Phase 2/3 completion and Phase 4 safe rollout
- Fixed accent precedence so a semantic class can override the shared Card neutral default; neutral is declared before semantic accent classes.
- Extended `CenterTileItem` with an optional semantic `accent` key while retaining `primary` as the default.
- Inventory Center tiles and its explanatory flow card now use the emerald inventory accent.
- Purchases search and table panels now use the amber procurement accent.
- Treasury branch selection and Financial Reports filter panel now use the violet finance accent.
- Reporting:
  - report chooser/filter surfaces use the cyan system accent;
  - report cards derive accent from `ReportCategory`;
  - sales = blue, purchases/costing = amber, inventory = emerald, treasury/financial = violet, utilities/analytics = cyan, generic/audit = neutral;
  - important report titles now wrap instead of being forcibly truncated;
  - report totals/counts use tabular numeric styling.
- Administration:
  - Users search/table panels use system accent;
  - Branches table panel uses system accent;
  - Approval Center filter panel uses system accent.
- POS operational/touch controls, KDS, payment, void/transfer modals and all printing/Print Agent surfaces remain untouched.
- Added/expanded `uiSurfaceAccentContract.test.ts` to lock the semantic rollout and accent-precedence contract.
- Current implementation head after this documented batch: `e8bca72347571afa16fd5b83dc7f7d4c3a41aae6`.
- Next: inspect remaining shared pages from repository state, then Phase 5 RTL/responsive checks and exact-head Full Verify before any merge.


### 2026-09-21 — Full Verify run #2126 Green on implementation head
- Verified exact PR head before documentation update: `79741aa7e75022697aa764d03dd1900290ecfe9b`.
- `main` remained unchanged at `ff2152b8f9849e9c03376fb69d87c83432f795d3`.
- PR #287 remained open, mergeable and not merged.
- Run #2126 results:
  - locked Supabase identity ✅
  - frontend API contract ✅
  - lint ✅
  - TypeScript ✅
  - application/test-suite typecheck ✅
  - unit ✅
  - build ✅
  - canonical migrations ✅
  - schema verification ✅
  - integration + security/RLS regression ✅
  - Playwright Browser Smoke ✅
- This verifies that the surface/accent/typography rollout did not regress the automated application, DB, security or browser-smoke gates.
- Browser Smoke is not treated as proof of pixel-perfect Light/Dark or every mobile width. Manual visual acceptance remains required for:
  - Light + Dark
  - Arabic + English
  - 360 / 390 / 430 px
  - tablet + desktop
  - long branch/user/product/report names.
- No printing, Print Agent, cloud print queue, KDS, send-to-kitchen, payment, stock-deduction, shift/day-close, RLS or permission logic was changed in this visual branch.
- Phase 4 safe rollout is considered complete because remaining shared pages automatically inherit the neutral shared Card/DataTable/DesignPanel strip; local semantic overrides are only used where the domain is explicit.
- This documentation commit changes HEAD, therefore a final CI rerun is required before any merge.
