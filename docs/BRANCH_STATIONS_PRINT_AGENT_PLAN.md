# Branch Stations + Premier Print Agent — Execution Plan

## Scope lock

Repository: `Premieros/johna-s`

Production Supabase: `azzdesuowpdcoflmyezn`

Production branch: `main`

Working branch: `development/branch-stations-print-agent`

This work must preserve all existing working flows and current user data. No direct changes to `main`, no force push, no weakening RLS/tests, and no Production migration before Full Verify Green plus explicit approval.

## Goal

Build one safe routing model:

`Agent Identity -> Available Branches -> Selected Branch -> Branch Stations -> Category/User Assignments -> Print Jobs -> Local Windows Printers`

The Windows agent must discover only the branches it is allowed to use, then load that branch's stations automatically, let an authorized operator map each station to a local Windows printer, and continuously print only jobs belonging to that branch/station.

## Non-negotiable compatibility rules

1. Preserve current working station/printing behavior until regression proves a change is required.
2. Reuse the existing print queue and existing station contracts when they are sufficient; do not create a parallel queue/backend.
3. Do not delete/reset/rewrite existing user data to fit the new model.
4. Any schema migration must be additive or safely constrained whenever possible.
5. If legacy data cannot be mapped safely, fail the migration/report the conflict rather than silently changing data.
6. Authorization is Permission-First; role names must not be used as authorization. Super Admin is the only implicit bypass.
7. Printer management remains hidden from users without the settings permission.
8. Printing failure must never be reported as successful physical printing.
9. Retry/restart must never duplicate a completed print job.
10. Existing POS/KDS/send_to_kitchen/stock-consumption logic must not be coupled to printer success.

## Phase 0 — Concurrency and baseline safety

Before every implementation batch:

- Fetch current `main` HEAD.
- Compare the working branch against `main`.
- Inspect overlapping files changed by other programs/PRs.
- If another change touches the same contract/table/RPC/component, stop that batch and reconcile first.
- Never overwrite concurrent work and never force-push.
- Keep commits small and scoped by phase.

Before PR/merge:

- Sync/reconcile against the latest `main` again.
- Re-run the full verification suite.

## Phase 1 — Audit the current working model

Document the actual current contract before changing it:

- station tables/views
- station RPCs/functions
- category-to-station assignments
- user-to-station assignments
- branch scoping/RLS
- current printer settings UI
- current print job/queue schema
- job creation path
- claim/retry/complete/fail path
- existing local print agent code, if any

Deliverable: a short contract map showing:

`UI -> API/RPC -> table/view -> branch permission/RLS -> print job -> physical print acknowledgement`

No schema changes in this phase.

## Phase 2 — Correct branch-owned station model

Target domain model:

- Every station belongs explicitly to exactly one branch (`branch_id`).
- Station names may repeat across branches because ownership is branch-specific.
- Each station can be active/inactive.
- A category assignment must reference a station in the same branch.
- A user assignment must reference a station in the same branch.
- Cross-branch assignments must be impossible at DB-contract level, not only hidden in UI.
- Existing valid assignments must be preserved.

Required reads:

- list branches available to the authenticated/authorized caller
- list active stations for one allowed branch
- list station category assignments
- list station user assignments

Required writes (settings permission only):

- create/update/deactivate branch station
- assign/unassign categories within the same branch
- assign/unassign users within the same branch

## Phase 3 — Safe migration strategy

Only if the audit proves schema changes are required:

1. Create migration on the development branch only.
2. Add new constraints/columns/contracts without deleting working data.
3. Backfill only rows that can be mapped deterministically.
4. Add explicit guards for ambiguous/orphan/cross-branch rows.
5. Migration must fail safely when a row cannot be mapped without guessing.
6. Add regression tests before any Production consideration.

Production `azzdesuowpdcoflmyezn` remains untouched until Full Verify Green and explicit approval.

## Phase 4 — Station settings UI

The settings UI must work by branch:

1. Select an allowed branch.
2. Show only that branch's stations.
3. For each station show:
   - name
   - active state
   - assigned categories
   - assigned users
4. Category/user selectors must only show records valid for the selected branch.
5. Cross-branch values must be rejected even if manually submitted.
6. Printer management/settings are visible only with the required settings permission.

Do not change unrelated POS/KDS screens in this phase.

## Phase 5 — Agent identity and available branches

The Windows agent must not receive unrestricted access to all branches.

Agent startup flow:

1. Agent authenticates with an agent-specific credential/token/session.
2. Backend returns only branches allowed for that agent.
3. UI shows the allowed branches.
4. Authorized operator selects a branch.
5. Selected branch is stored locally.
6. Changing branch requires the protected settings flow.

Never store a Supabase service-role key or database password in the Windows agent.

## Phase 6 — Automatic branch station discovery

After branch selection, the agent automatically reads:

- branch identity/name
- active stations for the branch
- station identifiers/codes
- routing metadata needed for printing

The agent must not use a hard-coded list such as only `kitchen`, `barista`, `cashier`.

If the branch later receives a new station, the agent can refresh and display it without rebuilding the Windows app.

## Phase 7 — Local Windows printer mapping UI

The Windows agent UI must:

- enumerate installed Windows printers
- show the selected branch
- show all active stations returned by the backend
- provide one printer selector per station
- provide Test Print per station
- show Online/Offline/error state
- show last successful print and pending/retry count when available

Local mapping model:

`station_id -> Windows printer name`

The local Windows printer name is device-specific and should remain local unless a proven existing project contract already stores it safely.

## Phase 8 — Print queue contract

Prefer the existing queue. Modify it only if the audit proves required fields/semantics are missing.

A printable job must be attributable to at least:

- `branch_id`
- `station_id` (or equivalent stable station reference)
- document/job type
- payload/reference
- status
- attempt/retry metadata
- created timestamp

Claim rules:

- Agent can claim only jobs for its selected allowed branch.
- Agent can claim only jobs for stations currently belonging to that branch.
- Claim must be atomic/concurrency-safe.
- Two agents must not successfully claim the same job simultaneously.

Completion rules:

- Queue/claim success is not physical print success.
- Mark printed/completed only after the agent reports successful delivery to the printer according to the chosen printer transport semantics.
- Failed jobs remain retryable with recorded error state.
- Completed jobs are idempotent and must not print again after restart/reconnect.

## Phase 9 — Routing behavior

Expected flow:

`POS/phone -> send_to_kitchen/order event -> station routing -> print job -> branch agent -> station printer`

Examples:

- food category -> kitchen station printer
- coffee/drinks category -> barista station printer
- receipt -> cashier station printer
- shisha category -> shisha station printer

Routing must derive from branch station assignments, not from hard-coded names in the Windows app.

## Phase 10 — Fault isolation

Each station/printer queue must be independently processable.

If Kitchen printer is offline:

- Kitchen jobs remain pending/retry.
- Barista continues printing.
- Cashier continues printing.
- Other station queues are not blocked.

Test:

- printer offline
- printer restored
- internet disconnected/reconnected
- agent restarted
- Windows restarted
- duplicate claim/retry attempts

## Phase 11 — End-to-end acceptance tests

### Single branch

Verify:

1. Agent lists only allowed branches.
2. Select Branch A.
3. Agent loads Branch A stations automatically.
4. Map each station to a Windows printer.
5. Captain creates order from phone.
6. send_to_kitchen routes each item once to its correct branch station.
7. Kitchen item prints only on Kitchen printer.
8. Barista item prints only on Barista printer.
9. Cashier receipt prints only on Cashier printer.
10. Retry does not consume stock twice and does not create duplicate completed prints.

### Multi-branch isolation

With Branch A and Branch B:

- Agent A cannot list/claim/print Branch B jobs unless explicitly allowed.
- Agent B cannot list/claim/print Branch A jobs unless explicitly allowed.
- Same station name in two branches does not create cross-routing.

### Permissions

Verify true permission separation:

- regular POS user cannot administer printer/station settings
- permitted settings user can manage allowed branch station mappings
- no role-name authorization shortcuts

## Phase 12 — Verification gate

Before PR is merge-ready:

- lint
- typecheck / typecheck:all as applicable
- unit tests
- integration tests
- schema/fresh DB tests if schema changed
- RLS/security tests
- production build
- browser smoke for affected settings/POS paths
- dedicated branch/station isolation tests
- dedicated print idempotency/retry tests

No test/RLS weakening is allowed to obtain Green.

## Phase 13 — PR and Production gate

1. Re-fetch latest `main`.
2. Reconcile any concurrent changes without force push.
3. Review final diff for scope creep.
4. Open a focused PR.
5. Require Full Verify Green.
6. Do not apply any Production migration yet.
7. Present exact migration/data-impact report for explicit approval.
8. Only after explicit approval, apply the approved migration to `azzdesuowpdcoflmyezn`.
9. Validate one real branch first without altering existing operational data.
10. Roll out to additional branches only after successful validation.

## Definition of Done

This work is complete only when:

- stations are truly branch-owned
- category and user station assignments are branch-safe
- existing valid data/flows remain intact
- Windows agent discovers only allowed branches
- agent loads the selected branch's current stations automatically
- operator can map each station to a local Windows printer
- agent starts automatically with Windows
- print jobs are pulled only for the selected branch/stations
- queues are isolated per station/printer
- retries do not duplicate completed prints
- a printer outage does not block other stations
- printer settings remain permission protected
- multi-branch RLS/isolation tests pass
- Full Verify is Green
- Production changes, if any, occur only after explicit approval

## Current implementation order

Execute in this order only:

`Audit current model -> Branch-owned stations -> Category/User assignments -> RLS/contracts -> Settings UI -> Agent branch discovery -> Station discovery -> Windows printer mapping -> Existing queue integration -> Fault isolation -> E2E -> Full Verify -> PR -> explicit Production approval`
