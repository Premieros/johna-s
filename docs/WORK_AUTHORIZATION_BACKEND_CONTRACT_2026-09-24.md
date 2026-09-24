# WORK AUTHORIZATION — BACKEND CONTRACT — 2026-09-24

Repository: `Premieros/johna-s`
Branch: `development/work-authorization-ui-20260924`
Status: **DESIGN LOCKED / NOT MIGRATED / NOT ACTIVE**
Production Supabase: `azzdesuowpdcoflmyezn`

## Purpose

Define the exact server contract for branch/shift work authorization before creating the migration.
This document is executable design, not a Production change.

The UI contract already exists in:

- `src/features/admin/work-authorization/workAuthorizationContract.ts`
- `src/features/admin/work-authorization/supabaseWorkAuthorizationProvider.ts`

The Production adapter is intentionally unmounted until this backend contract is implemented and verified.

## Non-negotiable authorization rules

1. **Permission-First only.**
   - Role names such as `owner`, `branch_manager`, `cashier`, etc. never authorize review, policy management, revocation, or bypass.
   - Super Admin remains the only implicit bypass through the existing canonical platform-admin function.
2. Branch scope is always enforced with the existing canonical branch-access contract.
3. No direct frontend writes to work-authorization tables.
4. No self-approval path.
5. No printing / Print Agent / printer routing / KDS / send-to-kitchen changes.
6. Rollout is fail-open for users who do not have an explicit requirement row.
   - **No policy row = work authorization not required.**
   - This prevents migration deployment from blocking existing branches.
7. Server authority is final. UI state cannot grant operational access.
8. Completed transactions are never rewritten if authorization is revoked.

## Canonical permissions

Add three permissions:

- `work.authorization.approve`
  - Review pending work-start requests.
  - Approve / reject requests.
  - Revoke active work authorization.
  - Branch scoped.
- `work.authorization.manage`
  - Configure which user requires authorization in which branch.
  - Requires `work.authorization.approve`.
  - Branch scoped.
- `work.authorization.bypass`
  - Explicitly bypass work authorization requirement for the holder.
  - Requires `work.authorization.approve`.
  - High-risk / critical permission.
  - Super Admin does not need this permission because it remains the single implicit bypass.

Capability-based migration seeding only:

- roles that currently possess `approvals.review` may receive `work.authorization.approve`;
- roles that currently possess `approvals.policy.manage` may receive `work.authorization.manage`;
- roles that currently possess `approvals.override` may receive `work.authorization.bypass`.

No migration statement may match or assign by role name.

## Data model

### 1. `work_authorization_policies`

One row per user + branch when a policy is explicitly configured.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null -> users(id) on delete cascade`
- `branch_id uuid not null -> branches(id) on delete cascade`
- `requires_authorization boolean not null default true`
- `created_by uuid -> users(id) on delete set null`
- `updated_by uuid -> users(id) on delete set null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- unique `(user_id, branch_id)`

Contract:

- absence of row means authorization is **not required**;
- target user must actually have access to the branch through primary or explicit branch access;
- only `work.authorization.manage` + branch access can create/update policy;
- user may read own effective requirement through RPC but not mutate policy directly.

### 2. `work_authorizations`

One durable request/authorization record.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null -> users(id) on delete cascade`
- `branch_id uuid not null -> branches(id) on delete cascade`
- `shift_id uuid null -> shifts(id) on delete set null`
- `status text not null`
- `requested_at timestamptz not null default now()`
- `requested_by uuid not null -> users(id)`
- `decided_at timestamptz null`
- `decided_by uuid null -> users(id)`
- `decision_reason text null`
- `revoked_at timestamptz null`
- `revoked_by uuid null -> users(id)`
- `revocation_reason text null`
- `expires_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Allowed states:

- `pending`
- `approved`
- `rejected`
- `revoked`
- `expired`

Meaning of `shift_id IS NULL` while approved:

- authorization is approved for the **next valid shift** in the branch;
- it must be bound once, to the first open shift that becomes current after approval;
- it cannot be reused by later shifts.

Required uniqueness:

- at most one pending request per `user_id + branch_id`;
- at most one approved unbound authorization per `user_id + branch_id`;
- at most one approved authorization per `user_id + branch_id + shift_id`.

### 3. `work_authorization_events`

Append-only authorization timeline.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `authorization_id uuid not null -> work_authorizations(id) on delete cascade`
- `user_id uuid not null -> users(id)`
- `branch_id uuid not null -> branches(id)`
- `shift_id uuid null -> shifts(id)`
- `event_type text not null`
- `actor_id uuid null -> users(id)`
- `note text null`
- `created_at timestamptz not null default now()`

Events:

- `requested`
- `approved`
- `rejected`
- `bound_to_shift`
- `revoked`
- `expired`

No direct update/delete from authenticated clients.

## Core server functions

### `requires_work_authorization(p_user_id uuid, p_branch_id uuid) returns boolean`

Rules:

- Super Admin => false;
- caller with `work.authorization.bypass` when checking self => false;
- otherwise true only when an explicit policy row exists with `requires_authorization=true`;
- policy never expands branch access.

### `can_user_work(p_branch_id uuid) returns boolean`

Canonical server gate for authenticated human operational mutations.

Order:

1. authenticated user exists and is active;
2. caller can access branch;
3. Super Admin => true;
4. `work.authorization.bypass` => true;
5. if no requirement => true;
6. find current open branch shift:
   - if open shift exists: require approved authorization bound to that shift;
   - if no open shift exists: require approved unbound authorization for the next shift.

No role-name conditions.

### `assert_user_work_authorized(p_branch_id uuid)`

Raises/returns one canonical error when `can_user_work` is false.

Canonical error:

- `WORK_AUTHORIZATION_REQUIRED`

UI mapping:

- Arabic: `يلزم اعتماد بدء العمل من مسؤول مخول قبل تنفيذ هذه العملية.`

### `get_my_work_authorization_state(p_branch_id uuid)`

Authenticated caller only.

Returns the UI contract shape:

- branchId
- branchName
- requiresAuthorization
- canWork
- status
- requestId
- authorizationId
- shiftId
- requestedAt
- decidedAt
- decisionReason

Must never expose another user's state.

### `request_work_authorization(p_branch_id uuid)`

Authenticated caller requests for self only.

Rules:

- branch must be accessible to caller;
- if requirement is false, return `not_required / canWork=true`;
- if valid approved authorization already exists, return it;
- if pending request already exists, return same pending request (idempotent);
- rejected/revoked/expired historical rows do not block a new request;
- requester cannot set target user or approver;
- append event + audit row.

### `get_work_authorization_snapshot(p_branch_id uuid default null)`

Requires `work.authorization.approve`.

Scope:

- supplied branch must be accessible;
- null means all accessible branches only;
- returns:
  - pending
  - active
  - history
  - policies
- settings/policy rows should only be included if caller also has `work.authorization.manage`.

The RPC must return UI-ready data but position/title values remain informational only.

### `decide_work_authorization(p_request_id uuid, p_approve boolean, p_reason text default null)`

Requires `work.authorization.approve`.

Rules:

- lock row `FOR UPDATE`;
- request must be pending;
- branch access required;
- requester cannot equal approver;
- target user must remain active and must still have branch access;
- reject requires a clear reason;
- approve with open shift => bind to current shift;
- approve without open shift => leave `shift_id null` as next-shift authorization;
- append event + audit.

### `revoke_work_authorization(p_authorization_id uuid, p_reason text)`

Requires `work.authorization.approve`.

Rules:

- branch access required;
- reason required;
- only approved authorization can be revoked;
- blocks future protected mutations immediately;
- append event + audit;
- if the user still has an explicit active requirement, create or reuse a new `pending` request for the same branch/current shift in the same transaction;
- the employee remains on the authorization gate until a fresh approval;
- does not change completed operations.

### `set_work_authorization_requirement(p_user_id uuid, p_branch_id uuid, p_required boolean)`

Creates or updates the effective user+branch policy.

Requires `work.authorization.manage`.

Rules:

- branch access required;
- target user must belong to/access branch;
- create the row when absent; update when present;
- no role-name conditions;
- append audit.

## Shift binding contract

### When no shift is open

An approved authorization with `shift_id null` permits the user to reach operations necessary to open the branch shift only when the caller also owns the normal operational permission (for example `shifts.open`).

Work authorization never substitutes for the existing operational permission.

### When a shift opens

A server-side shift lifecycle hook binds eligible approved/unbound authorizations for that branch to the newly opened shift:

- set `shift_id`;
- append `bound_to_shift` event.

The binding must not touch printing, KDS, or kitchen send logic.

### When a shift closes

A server-side lifecycle hook expires all still-approved authorizations bound to that shift:

- status -> `expired`;
- append `expired` event.

A later shift therefore requires a fresh authorization.

## RLS / grants

All three tables must have RLS enabled.

Direct write policy:

- authenticated clients: **no direct INSERT / UPDATE / DELETE**;
- mutations go through hardened RPCs only.

Select policy:

- user may read own authorization state/history rows when needed;
- approver may read rows only for accessible branches and only with `work.authorization.approve`;
- policy management rows visible to `work.authorization.manage` within accessible branches;
- service_role/postgres retain required maintenance access.

All SECURITY DEFINER functions:

- explicit `SET search_path = public, pg_temp`;
- explicit `auth.uid()` validation;
- explicit permission and branch checks;
- revoke PUBLIC/anon execute;
- grant only required roles.

## Entry-gate contract

The employee flow is centralized:

`Login -> Resolve active branch -> Work Authorization Gate -> Application`

Frontend behavior:

- check once after a verified login/profile is available;
- check again only when the active branch changes;
- do not mount Dashboard/POS/report pages while the gate is blocked;
- keep the authenticated session mounted while waiting;
- revocation/approval changes are pushed by Realtime and trigger one lightweight state refresh;
- no page-level or button-level authorization polling.

Server-side mutation guards remain authoritative and indexed; they are not a frontend polling mechanism.

## Realtime contract

No aggressive polling.

Preferred behavior:

- employee gate loads state once by RPC;
- a Realtime signal for the current user's authorization **or policy** causes one lightweight state RPC refresh;
- revocation moves the worker to `pending`, so the same Realtime update immediately returns the UI to the waiting gate;
- manager center may subscribe to authorization changes for accessible branch scope;
- no direct table mutations from Realtime client code.

Realtime is not required to activate server enforcement; server gate remains authoritative if realtime is delayed.

## Rollout order

1. Add canonical permissions to frontend permission definitions/contracts.
2. Add centralized entry gate component between Auth and the application shell.
3. Create backend migration on the development branch and validate from a Fresh DB.
4. Add schema + RLS + RPCs + shift lifecycle hooks.
5. Add integration/security tests.
6. Fresh DB verify.
7. Mount production provider in Approval Center only.
8. Verify manager center against real RPCs.
9. Mount the employee entry gate once at the authenticated app boundary.
10. Add Realtime status refresh for approval/revocation; no polling.
11. Add server enforcement to selected operational mutation boundaries.
12. Expand enforcement only after regression tests cover each protected boundary.
13. Full Verify on exact head.
14. Explicit approval before Production migration.
15. Production apply.
16. Controlled enablement by adding policy rows to selected user+branch pairs.

## Required regression matrix

- user with no policy row continues working;
- policy required + no request => denied by server gate;
- pending => denied;
- approved next-shift + no shift => only normal permitted pre-shift actions are possible;
- approved authorization binds to opened shift;
- approved bound user succeeds;
- close shift expires authorization;
- next shift requires new approval;
- rejected request may be requested again;
- revoked user is denied immediately;
- self approval denied;
- approver without `work.authorization.approve` denied;
- manager outside branch denied;
- manager with permission inside accessible branch succeeds;
- manage permission cannot widen branch scope;
- non-Super-Admin cannot grant work authorization permissions they do not own;
- Super Admin implicit bypass works;
- explicit bypass permission works only for its holder;
- direct table mutations denied;
- audit/events created;
- duplicate concurrent requests collapse safely;
- duplicate concurrent approvals do not create multiple active authorizations;
- current operational approval queue remains unchanged;
- printing/KDS/Print Agent/send-to-kitchen behavior unchanged.
