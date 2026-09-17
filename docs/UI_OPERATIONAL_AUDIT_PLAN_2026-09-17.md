# UI Operational Audit Remediation Plan — 2026-09-17

## Scope

Independent UI/operational remediation only, based on `main` at baseline SHA `21c076a5bb71cf860de28f80df45bff41e17eccd`.

Repository: `Premieros/johna-s`

Working branch: `development/ui-operational-audit-20260917`

This work MUST NOT:
- modify `main` directly;
- touch Production Supabase;
- run Production migrations;
- change printing logic;
- weaken RLS, permissions, or tests;
- interfere with any other active development branch.

## Objective

Make the application shell and key operational UI fully permission-aware, directionally correct in Arabic/English, less misleading during navigation, and safer against UI state regressions.

## Staged plan

### Phase 0 — Baseline and documentation
Status: COMPLETE

### Phase 1 — Permission-aware application shell
Status: COMPLETE

### Phase 2 — RTL/LTR shell correctness
Status: COMPLETE

### Phase 3 — Permission-aware dashboard navigation
Status: COMPLETE

### Phase 4 — POS operational state regression hardening
Status: COMPLETE — FINDING DOCUMENTED / SOURCE CHANGE DEFERRED

Confirmed finding:
- `hasUnsentItems` reads `kitchenSendsForActive` without depending on it directly.
- Runtime source fix is deferred to the POS-owning workstream to avoid branch overlap.
- No stock deduction logic changed.

### Phase 5 — Navigation density / permission granularity audit output
Status: COMPLETE

Output:
- `docs/UI_OPERATIONAL_AUDIT_RECOMMENDATIONS_2026-09-17.md`
- Sidebar-density recommendations documented without route removal.
- Finance permission-granularity gaps documented without changing the permission contract.
- Mobile POS maintainability risks documented separately from operational logic.

### Phase 6 — Full verification and handoff
Status: IN PROGRESS

- Review diff against baseline.
- Run/inspect available CI checks.
- Record exact HEAD, changed files, checks, remaining risks.
- Open a PR only from this branch to `main`; do not merge without explicit approval.

## Update rule

After every completed phase:
1. update this document's phase status;
2. append exact work, files, commit SHA, verification, and remaining risks to `docs/UI_OPERATIONAL_AUDIT_LOG_2026-09-17.md`;
3. do not proceed if the phase reveals a security/RLS/Production dependency outside this scope.