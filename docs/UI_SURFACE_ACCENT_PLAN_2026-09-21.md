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
**Status: IN PROGRESS**

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
**Status: PENDING**

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
**Status: PENDING**

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
**Status: PENDING**

- distinguish table header from page surface;
- add subtle section strip on filter/tool bars;
- preserve dense row readability;
- no rainbow rows;
- keep hover/selected states separate from domain accent.

## Phase 4 — Page rollout
**Status: PENDING**

Order:
1. Dashboard cards below the StandBy strip.
2. Inventory / warehouse.
3. Purchases.
4. Accounting / finance.
5. Reports.
6. Settings / admin surfaces.
7. Remaining shared pages.

POS operational workspace is reviewed separately after shared primitives are stable so visual work cannot disturb touch layout or critical controls.

## Phase 5 — Responsive + RTL typography
**Status: PENDING**

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
**Status: PENDING**

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

- `docs/UI_SURFACE_ACCENT_PLAN_2026-09-21.md` — created as live plan/execution log.

No runtime/UI code changed yet in this branch at the time of this log creation.

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
