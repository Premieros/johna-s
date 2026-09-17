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
Status: IN PROGRESS

- Freeze baseline SHA.
- Create this plan and a separate execution log.
- Record audit findings and acceptance criteria.

### Phase 1 — Permission-aware application shell
Status: PENDING

- Hide/disable Active Orders entry when `floor_plan.view` is unavailable.
- Stop the user identity control from acting as an unconditional Settings shortcut.
- Preserve existing route guards as defense in depth.
- Add focused regression coverage where existing test structure permits.

Acceptance:
- UI does not advertise inaccessible shell actions.
- No authorization logic is moved from server/RLS to UI.
- Existing permitted users retain access.

### Phase 2 — RTL/LTR shell correctness
Status: PENDING

- Arabic sidebar remains right-aligned.
- English sidebar becomes left-aligned.
- Header desktop offset follows sidebar side.
- Mobile drawer open/close transforms remain correct in both directions.

Acceptance:
- No overlap between fixed sidebar and fixed header at desktop sizes.
- Mobile drawer enters/exits from the correct side.

### Phase 3 — Permission-aware dashboard navigation
Status: PENDING

- Audit clickable dashboard metrics/actions.
- Do not present links to pages the current user cannot open.
- Prefer non-clickable metric presentation over redirect loops.

Acceptance:
- A user with `dashboard.view` only never receives misleading CTA navigation.

### Phase 4 — POS operational state regression hardening
Status: PENDING

- Review immediate Send-to-Kitchen -> Pay UI state.
- Correct memo/dependency issues only if reproducible from code/test evidence.
- Add regression test for session-local kitchen-send fallback if feasible.

Acceptance:
- Successful kitchen send can enable the next allowed action immediately without waiting for Realtime.
- No stock deduction logic changes.

### Phase 5 — Navigation density / permission granularity audit output
Status: PENDING

- Document menu-density recommendations separately from implementation.
- Document finance permission-granularity gaps without changing authorization contracts in this branch.
- Do not redesign information architecture without explicit approval.

Acceptance:
- Recommendations are actionable but no scope creep changes are introduced.

### Phase 6 — Full verification and handoff
Status: PENDING

- Review diff against baseline.
- Run/inspect available CI checks.
- Record exact HEAD, changed files, checks, remaining risks.
- Open a PR only from this branch to `main`; do not merge without explicit approval.

## Update rule

After every completed phase:
1. update this document's phase status;
2. append exact work, files, commit SHA, verification, and remaining risks to `docs/UI_OPERATIONAL_AUDIT_LOG_2026-09-17.md`;
3. do not proceed if the phase reveals a security/RLS/Production dependency outside this scope.