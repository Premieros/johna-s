# Branch Stations + Premier Print Agent — Execution Plan

## Safety rules
- Work only on a development branch created from the latest `main`.
- Never modify `main` directly and never force-push.
- No Production migration without Full Verify Green and explicit approval.
- Preserve all existing user data and proven working flows.
- Do not create a second print queue if the current queue/agent stack can be extended safely.
- Permission-first; only Super Admin has implicit bypass.
- Before every write, re-check whether `main` moved and review overlapping changes.

## Target architecture
`Agent identity -> available branches -> selected branch -> branch stations -> local Windows printers -> print jobs`

## Phase 1 — Current-contract audit
1. Confirm canonical branch station contracts (`kitchen_stations`, assignments, RPCs, RLS).
2. Confirm current printer settings/Local Print Agent contracts and all call sites.
3. Confirm no duplicate station or print-queue model is required.
4. Record any proven incompatibility before changing logic.

## Phase 2 — Dynamic branch station printer routing
1. Keep cashier/receipt as the special local route.
2. Load active kitchen stations for the selected branch from the canonical station RPC.
3. Render one local Windows-printer mapping per active branch station.
4. Preserve legacy aliases only as a temporary fallback when the canonical station contract is unavailable.
5. Never delete hidden/saved routes automatically.
6. Keep printer mappings local to the Windows device.

## Phase 3 — Branch discovery in Windows Agent
1. Agent authenticates with a scoped identity, never a service-role key.
2. Load only branches that identity may access.
3. First run: choose one available branch and persist the selection locally.
4. Allow branch change only from protected settings.
5. Load the selected branch's active stations dynamically.

## Phase 4 — Queue integration
1. Reuse the existing print queue architecture after revalidation against current `main`.
2. Claim jobs atomically and branch-scoped.
3. Keep independent FIFO processing per physical printer/station.
4. Printing retries must never rerun order/payment/inventory mutations.
5. Never report physical `printed` success from an ambiguous spool submission.

## Phase 5 — Windows UX
- Show current branch and connection state.
- Show discovered Windows printers.
- Show one row per active branch station.
- Allow printer selection and test print.
- Show pending/error status without blocking other printers.
- Start automatically with Windows and recover after restart/network loss.

## Phase 6 — Verification
1. Typecheck, lint, unit, integration, security/RLS, build.
2. Two-branch isolation test.
3. End-to-end: captain/phone -> send_to_kitchen -> station split -> print job -> Windows printer.
4. Offline printer, network loss, agent restart, Windows restart, retry, and duplicate-prevention tests.
5. Compare against the currently working model before/after.

## Production gate
No Production change until the development PR is Full Green, reviewed against the latest `main`, and explicit approval is given.
