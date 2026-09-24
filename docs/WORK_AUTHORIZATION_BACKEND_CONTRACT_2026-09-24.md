# WORK AUTHORIZATION — BACKEND CONTRACT — 2026-09-24

Repository: `Premieros/johna-s`
Branch: `development/work-authorization-ui-20260924`
Status: **IMPLEMENTED ON DEVELOPMENT BRANCH / NOT ACTIVE**
Production Supabase: `azzdesuowpdcoflmyezn`

## Purpose

Provide a centralized work-entry authorization gate:

`Login -> Resolve active branch -> Work Authorization Gate -> Application`

The authorization is **user + branch scoped and independent of shift lifecycle**. Once approved, it remains valid until explicitly revoked, the policy is disabled, branch access is removed, or the account is deactivated. Opening or closing a shift must not change the work authorization.

## Non-negotiable rules

1. Permission-First only; role names never authorize review, management, revoke, or bypass.
2. Super Admin remains the only implicit bypass through the existing canonical platform-admin path.
3. Branch scope is enforced through the canonical branch-access contract.
4. No direct frontend mutations to work-authorization tables.
5. No self-approval.
6. No policy row means authorization is not required (fail-open rollout).
7. Server authority is final; frontend state cannot grant access by itself.
8. Revocation never rewrites completed transactions.
9. Printing / Print Agent / printer routing / KDS / send-to-kitchen remain out of scope.

## Canonical permissions

- `work.authorization.approve`
  - review pending requests;
  - approve/reject;
  - stop active authorization;
  - branch scoped.
- `work.authorization.manage`
  - configure which user requires authorization in which branch;
  - depends on `work.authorization.approve`.
- `work.authorization.bypass`
  - explicit bypass for the holder;
  - depends on `work.authorization.approve`;
  - critical permission.

Capability-based migration seeding only:

- existing `approvals.review` -> may receive `work.authorization.approve`;
- existing `approvals.policy.manage` -> may receive `work.authorization.manage`;
- existing `approvals.override` -> may receive `work.authorization.bypass`.

No migration statement may assign by role name.

## Data model

### `work_authorization_policies`

One row per user + branch when explicitly configured.

Core columns:

- `id`
- `user_id`
- `branch_id`
- `requires_authorization`
- `created_by`
- `updated_by`
- timestamps

Unique: `(user_id, branch_id)`.

Absence of a row means authorization is not required.

### `work_authorizations`

Durable request / authorization record scoped to user + branch.

Core columns:

- `id`
- `user_id`
- `branch_id`
- `status`
- request / decision / revoke timestamps and actors
- optional decision/revocation reason
- timestamps

States:

- `pending`
- `approved`
- `rejected`
- `revoked`

Uniqueness:

- at most one pending row per user + branch;
- at most one approved row per user + branch.

No shift foreign key is used.

### `work_authorization_events`

Append-only timeline:

- requested
- approved
- rejected
- revoked

No shift-binding events exist.

## Core server functions

### `requires_work_authorization(p_user_id, p_branch_id)`

- Super Admin => false;
- self with explicit bypass => false;
- otherwise true only when an explicit policy row says `requires_authorization=true`.

### `can_user_work(p_branch_id)`

Order:

1. authenticated active user;
2. branch access;
3. Super Admin => true;
4. explicit bypass => true;
5. no requirement => true;
6. otherwise require one active approved user+branch authorization.

No shift lookup and no role-name conditions.

### `assert_user_work_authorized(p_branch_id)`

Canonical mutation guard.

Error:

`WORK_AUTHORIZATION_REQUIRED`

Arabic UI mapping:

`يلزم تصريح بدء العمل من مسؤول مخول قبل تنفيذ هذه العملية.`

### `get_my_work_authorization_state(p_branch_id)`

Returns only the caller state for that branch:

- branchId / branchName
- requiresAuthorization
- canWork
- status
- requestId
- authorizationId
- requestedAt
- decidedAt
- decisionReason

### `request_work_authorization(p_branch_id)`

- self only;
- accessible branch only;
- idempotent pending request;
- approved users stay approved;
- revoked/rejected history does not block a new request;
- append event + audit.

### `get_work_authorization_snapshot(p_branch_id default null)`

Requires `work.authorization.approve`.

Returns UI-ready:

- pending
- active ("working now" = active user accounts with approved authorization)
- history
- policies (only when caller also has `work.authorization.manage`)

Null branch means all accessible branches only.

### `decide_work_authorization(...)`

Requires `work.authorization.approve`.

- pending only;
- branch access required;
- no self-approval;
- target must still be active and branch-accessible;
- rejection requires reason;
- approval creates persistent branch authorization;
- append event + audit.

### `revoke_work_authorization(...)`

Requires `work.authorization.approve`.

Atomic behavior:

1. approved -> revoked;
2. append revoke event + audit;
3. if the explicit requirement is still active, create or reuse a new pending request for the same user + branch;
4. `can_user_work` becomes false immediately;
5. Realtime wakes the employee gate;
6. employee returns to "waiting for authorization";
7. fresh manager approval is required before re-entry.

Completed transactions remain unchanged.

### `set_work_authorization_requirement(user_id, branch_id, required)`

Requires `work.authorization.manage`.

- branch access required;
- target user must have branch access;
- creates or updates the user+branch policy;
- append audit;
- no role-name conditions.

## Shift independence contract

Opening or closing a shift:

- does not create work authorization;
- does not consume work authorization;
- does not expire work authorization;
- does not bind work authorization to a shift.

Shift permissions and normal shift business rules remain separate.

This is intentional to keep the entry gate simple and avoid repeated authorization checks caused by shift lifecycle changes.

## Entry gate

Frontend:

- check once after authenticated profile + active branch are resolved;
- check again on active branch change;
- Realtime event triggers one lightweight state refresh;
- no polling;
- no per-page or per-button authorization queries;
- blocked users do not mount operational routes.

An approver with `work.authorization.approve` may access the Approval Center itself while their own work authorization is pending to avoid approval deadlock. This exception does not open the rest of the application.

`CloudPrintAgent` stays outside the gate so background printing is unaffected.

## Realtime

Publication tables:

- `work_authorizations`
- `work_authorization_policies`

Realtime only wakes the UI; RPC state remains authoritative.

No polling loop.

## RLS / grants

- RLS enabled on all work-authorization tables.
- Authenticated clients receive SELECT only where policy permits.
- No authenticated direct INSERT / UPDATE / DELETE.
- All mutations go through hardened SECURITY DEFINER RPCs.
- Functions use `SET search_path = public, pg_temp`.
- PUBLIC/anon execute revoked where applicable.
- Branch access + canonical permission checks remain mandatory.

## Rollout safety

- Feature flag: `VITE_WORK_AUTHORIZATION_GATE=0` by default.
- Migration exists only on development branch until approved.
- No Production activation until exact-head Full Verify is Green and explicit approval is given.
- Controlled enablement is performed by adding policy rows to selected user+branch pairs.
- No policy rows = current branch operation continues unchanged.

## Required regression matrix

- no policy => allowed;
- requirement + no request => blocked;
- pending => blocked;
- approved => allowed;
- shift open/close does not change approved state;
- revoke => revoked + pending + blocked immediately;
- reapprove pending => allowed again;
- self approval denied;
- out-of-branch approver denied;
- manage cannot widen branch scope;
- direct table writes denied;
- audit/events created;
- duplicate pending requests collapse safely;
- duplicate approvals cannot create multiple active approvals;
- Realtime has no polling;
- Approval Center displays active authorized users by branch;
- Print Agent / printing / KDS / send-to-kitchen behavior unchanged.
