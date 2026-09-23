# WORK AUTHORIZATION GATE — LIVE WORK LOG — 2026-09-23

## Identity / Safety Lock

- Repository: `Premieros/johna-s`
- Working branch: `development/work-authorization-gate-20260923`
- Production branch: `main`
- Base at branch creation: `main@d036a963bf5681b52cc037abd1d583f38af701e9`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Status: **PLANNED / IMPLEMENTATION NOT STARTED**
- Production migration: **NOT APPLIED**
- Main merge: **NOT PERFORMED**
- Printing / Print Agent / printer routing / KDS / send-to-kitchen: **FROZEN / OUT OF SCOPE**
- Authorization rule: Permission-First; Super Admin is the only implicit bypass.
- No direct writes to `main`, no force push, no RLS weakening, no test removal.
- Any Production migration requires exact-head Full Verify Green + explicit user approval.

## Goal

Prevent users who require work authorization from performing operational mutations until an authorized approver allows them to start work for the relevant branch/shift, while keeping login/session valid and preserving existing branch/RLS/permission behavior.

## Confirmed Current-State Findings

1. Existing approval infrastructure already exists:
   - `approval_requests`
   - `ApprovalInbox.tsx`
   - `ApprovalCenterPage.tsx`
   - `approvals.review`
   - `approvals.policy.manage`
   - unified operational approval queue.
2. Existing `approval_requests` is unsuitable as the work-session source of truth:
   - designed for single sensitive operations;
   - default approval expiry is 10 minutes;
   - approved requests can be consumed once.
3. Existing operational guard infrastructure already checks permission/branch/prerequisites and is the preferred integration point for UI guidance.
4. Server-authoritative RPCs remain the final enforcement point; UI-only blocking is explicitly rejected.
5. Existing `ApprovalInbox` still contains role-name visibility logic for manager/owner/super-admin. New work authorization must not repeat that pattern and should be Permission-First.

## Approved UX

### Employee flow

`Login -> Active Branch -> Work Authorization Check -> Approved = Workspace / Pending = Waiting Screen`

Waiting screen:
- employee identity;
- active branch;
- request time/state;
- clear `Waiting for approval` status;
- realtime transition after approval;
- no manual refresh requirement;
- safe actions only: change branch (when allowed) and sign out;
- rejection reason shown when available;
- retry request action after rejection/expiry.

### Approver flow

Reuse and extend the existing Approvals & Authorizations Center rather than create a second admin center.

Target tabs:
1. Pending approval
2. Working now
3. History
4. Settings

Mobile: card-first actions.
Desktop: clear queue/table or responsive cards.

Required actions:
- Approve
- Reject with optional/required reason according to contract
- Revoke an active work authorization

### User / branch settings

Work authorization requirement is branch-scoped, not role-name-scoped.

Target setting:
- `requires_work_authorization` per user + accessible branch.

Planned permissions:
- `work.authorization.approve`
- `work.authorization.manage`
- optional explicit `work.authorization.bypass`

Super Admin remains the only implicit bypass.

## Data / State Model

Do not overload one-shot `approval_requests` as the authorization truth.

Planned lifecycle:
- `pending`
- `approved`
- `rejected`
- `revoked`
- `expired`

Authorization scope:
- user
- branch
- shift when available

Pre-shift deadlock rule:
- an approval may be granted for the next branch shift when no shift is open;
- it binds to the first valid shift opened under the defined contract;
- it cannot be reused for a later shift.

## Enforcement Contract

Server order for protected operational mutations:

`Authenticated -> Branch Access -> Permission -> Work Authorization -> Execute`

The gate must protect operational mutations, including the applicable POS/payment/order/shift and other branch operations. Read-only access may remain available where safe and useful.

Must fail closed on direct RPC/API attempts even if the UI is bypassed.

Revocation:
- blocks new protected mutations immediately;
- never rewrites or deletes already completed transactions.

Shift closure:
- expires/ends shift-bound authorization;
- the next shift requires a new valid authorization where the user/branch setting requires it.

## Implementation Phases

### Phase 0 — Baseline / Audit / Work Log
Status: **COMPLETE**

- [x] Inspect latest `main`.
- [x] Inspect approval center, approval inbox, permission model, shift API, auth/session, branch filtering and operational guards.
- [x] Confirm no printing changes are needed.
- [x] Create isolated development branch.
- [x] Create this live work log.
- [ ] Register this work in `docs/CURRENT_WORK_PLAN.md`.

### Phase 1 — Schema + Permission Contract
Status: **NOT STARTED**

Planned:
- append-only migration;
- work authorization state table(s);
- branch-scoped requirement setting;
- canonical permissions;
- strict RLS;
- audit records;
- duplicate-pending prevention;
- self-approval prevention;
- revoke/expiry rules.

No Production apply in this phase.

### Phase 2 — Server Authority
Status: **NOT STARTED**

Planned RPC contract:
- get current work-authorization state;
- request work authorization;
- approve/reject;
- revoke;
- bind next-shift authorization safely;
- canonical `can_user_work(...)`/equivalent server check;
- integrate with protected operational mutation boundaries without modifying printing/send-to-kitchen behavior itself.

### Phase 3 — Employee Gate UI
Status: **NOT STARTED**

- waiting screen;
- realtime state updates;
- clear Arabic-first states;
- no polling loop;
- correct multi-branch behavior;
- session remains mounted.

### Phase 4 — Approver Center UI
Status: **NOT STARTED**

- Pending / Working now / History / Settings tabs;
- filters by accessible branch only;
- responsive mobile cards;
- approve/reject/revoke;
- Permission-First visibility and actions.

### Phase 5 — User / Branch Administration
Status: **NOT STARTED**

- per-user/per-branch authorization requirement;
- permission-controlled administration;
- no role-name authorization.

### Phase 6 — Regression / Security Verification
Status: **NOT STARTED**

Must cover:
- approval;
- rejection;
- expiry;
- revocation while logged in;
- direct RPC bypass attempt;
- self-approval forbidden;
- branch isolation;
- multi-branch user;
- no-open-shift / next-shift binding;
- shift closure invalidation;
- session/network recovery;
- current permission behavior unchanged;
- printing/KDS/Print Agent untouched.

### Phase 7 — Full Verify / Handover
Status: **NOT STARTED**

- latest-main drift check;
- exact-head Full Verify;
- document results here;
- no Production migration without explicit approval;
- no merge to main without explicit approval.

## Change Ledger

### 2026-09-23 — Phase 0

- User approved the design and requested a persistent live work log.
- Created development branch from `main@d036a963bf5681b52cc037abd1d583f38af701e9`.
- Inspection confirmed reuse of the existing Approvals Center is preferable to creating a parallel approval UI.
- Existing one-shot manager approval records will remain logically separate from shift/work authorization.
- No application code, migration, Production DB, printing, KDS or send-to-kitchen changes made yet.

## Verification Ledger

- Baseline inspection: complete.
- Code tests: not yet applicable (no implementation changes yet).
- Full Verify: pending implementation.
- Production: untouched.
