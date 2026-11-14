# A1 storage foundation and per-branch rollout boundary

Repository: Premieros/johna-s. No Premieros/.com work. No production connection.
This is private runtime development, NOT an installed branch hub or POS release.

## Owner directive

The owner wants all local runtime, sync and update components prepared while each
operating branch continues using its existing cloud system until its own local
installation. Installing/copying files must not itself change a branch's URL,
Supabase connection, Auth session, kitchen ownership, printer agent or old queues.
Activation is a separate branch-specific handoff after local readiness, enrollment,
backup and reconciliation. Other branches stay cloud-connected. Never introduce a
global automatic redirect or competing cloud/local writers as a rollout shortcut.

The current src/ web app and electron/ print shell are unchanged in this work.
No production query, export, SQL/password change, cloud deployment or branch
redirection is performed. Existing cloud reporting and application updates remain
available normally. The personal PC and existing update trial stay isolated labs.

## Implemented private operation store

`branch-hub/runtime/operation-store.mjs` accepts an exclusively owned PGlite-style
transaction adapter, one enrolled branch ID, registered server handlers and an
explicit authorization callback. It creates only private `branch_hub_v1` metadata
in that owned database; it never accepts a database URL, .env, SQL from a client,
network destination or a production credential. It has no HTTP listener.

One SQL transaction owns:
- Original business RPC/handler effects.
- Immutable command and original result in the inbox.
- Pending outbox row.
- Device sequence advance.

A failed effect/outbox/sequence insert rolls all four back. A completed local ACK
is returned only after transaction completion and explicit filesystem sync. If
sync reports failure after commit, the caller gets no success; retry returns the
saved result instead of rerunning the business handler. This does not claim a
client received that ACK or that all storage/power-loss modes are solved.

Repeated IDs require identical digests. Sequence gaps/reuse are rejected; there is
no invented automatic gap repair. The authorization callback is checked even for
replays. A different enrolled branch is rejected. Pending batches are bounded to
100 and kept until a verified receipt matches operation/branch/digest. ACK marks
records acknowledged; it does not delete financial history or unsent operations.
Receipt verification has no permissive default. The real cryptographic cloud
receipt authority and transport are NOT implemented by this callback seam.

Tables have RLS enabled and PUBLIC schema/table access revoked. There are no client
policies or grants: only the trusted store owner is intended to access metadata.
Business handlers must use the supplied SQL transaction; network calls, printer
execution, separate connections or nested commits violate this contract. The store
serializes its own callers; it is NOT an inter-process database lock or independent
SQL writer service. Caller must own the database exclusively.

## Executable evidence

Five private-store checks pass locally:
1. Eight simultaneous retry callers produce one business effect/inbox/outbox.
2. Injected outbox failure rolls back the business record and device cursor; retry
   after removing the fault succeeds without poisoning the writer queue.
3. Authorization/branch checks and receipt verification fail closed; a valid ACK
   removes only the pending classification, retaining all operation records.
4. A fault at the store's post-commit flush boundary returns no successful ACK;
   retry observes the committed effect once.
5. A child process is killed after committed SQL+sync with a pending outbox, then
   reopened on the same Node filesystem. Retry returns the original result once.
   A second kill inside an uncommitted handler leaves no second ledger/outbox row.

A separate Vitest fixture loads all 558 canonical migrations and existing CI-only
Auth/subscription/permission fixtures into a disposable owned memory database.
It runs the original `process_sale_split_idempotent` with cash/card tenders through
the store: one sale/two tenders/one stock deduction plus outbox commit together.
A forced outbox trigger error rolls back the second sale, tenders and stock; a
later retry succeeds. This test changes no canonical migration or business RPC.
It uses synthetic identity and does not prove actual offline login/authorization.

The five crash/storage checks use a synthetic ledger, not the full POS database.
The canonical split RPC check uses memory, not the disk crash harness. Combining
those two results is NOT proof that every POS operation survives power loss.
Windows disk/forced-shutdown, installer, cross-client races, backups, real Auth,
full canonical business-on-disk recovery and production-scale throughput remain
open. PGlite remains a candidate; no engine is approved for branch installation.

## Delivery status and next work

| Component | Actual state |
| --- | --- |
| Existing cloud POS, KDS and printers | Unchanged |
| Personal-PC signed presentation trial | User confirmed working; synthetic local feed only |
| Canonical SQL compatibility | 558 migrations and 17 original selected cases pass |
| Atomic operation/outbox | Implemented private core; five synthetic checks and one canonical split fixture pass locally |
| API/local Auth/LAN/shared POS UI | Not implemented |
| Real cloud/config transport and receipt authority | Not implemented |
| Code/schema release updater | Not implemented; presentation experiment is not a code updater |
| Windows install/repair/backup/recovery | Not ready |
| Branch enrollment/cutover | Not performed; requires tested branch-specific handoff |

Next: prove full canonical transactions on disk plus backup/restore, then add a
single-owner authenticated local service and assets from the actual POS with a
separate explicitly local build. Keep the deployed cloud client unchanged. Do not
send another prototype package to a branch as if it were the installer.
