# Johna's branch-local-first delivery plan

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/johnas-branch-local-first-20261114`
Current PR: `#638`
Last updated: 2026-11-14, Africa/Cairo

## Work status
State: **BLOCKED** for runtime rollout. The owner has authorized changing the active
work track to one local-first installation per branch with automatic cloud sync
and verified application/schema updates. This document records that scope; it
does not claim a working installer, migrated branch, or complete offline system.

## Guardrails
Keep all operating branches on their current system throughout preparation.
Preserve published POS/printing/permission/costing behavior and the existing local
pilot. No production schema or password changes, data exports, branch redirection,
router openings, app deployment, or print-agent replacement in this planning PR.
Do not modify Premieros/.com, its database or its Branch Hub in this scope.
A GitHub commit is not an update authorization: distribute only explicitly
published, tested releases. No automatic execution of arbitrary SQL from GitHub.

## Baseline
Current main files were inspected:
- src/core/offline/offlineStorage.ts: browser IndexedDB caches, sale/order queues,
  retry metadata; it is not a shared branch server.
- src/core/offline/syncEngine.ts: queued sale replay/reconciliation with bounded
  retries and ownership checks. It is not a general two-way replication engine.
- src/features/pos/services/offlinePos.ts: a second localStorage-based queue path;
  audit/consolidate callers before migration, never let both replay the same sale.
- electron/main.cjs: remote website shell plus printer workers; the UI currently
  defaults to https://premieros.github.io/johna-s/.
- electron/package.json: Electron packaging exists; this alone supplies no shared
  database, LAN API, complete offline runtime or verified updater.
The personal-PC Supabase pilot is an isolated lab, not the branch deployment.
Its cloud password/export blocker is not a prerequisite for design/prototyping.

## Root-cause ledger
A cached screen or queued invoice cannot keep all branch devices, kitchen state,
permissions and physical printing consistent during an outage. Independent local
databases on every cashier would introduce multiple writers and duplicate effects.
A generic full bidirectional table mirror would also duplicate business side
effects and cannot safely resolve financial conflicts.

## Change ledger
### Target topology
One designated always-on branch hub computer owns that branch's local database,
operational API and local UI assets. Cashier, kitchen and phones use that hub over
the LAN. Cloud outages do not redirect those clients to a second writable store.
The local commit is authoritative for branch operations; cloud synchronization
acknowledges durable operations afterward. Local hub hardware failure is a separate
failure mode requiring backup/recovery, not an excuse for uncontrolled dual writes.

A Windows installer must provision/start/stop/repair the hub, persist data outside
the app installation directory, and expose diagnostics and a documented LAN URL.
Do not assume Docker, WSL, an 8 GB machine or administrator access at every branch.
Database ports stay private; LAN clients use authenticated branch-scoped APIs.
Package application assets and required offline fonts/resources locally.

### Ownership and synchronization
- Branch-owned: orders, line changes, kitchen sends, cash movements/payments,
  shift events and print intents are committed atomically with an outbox record.
- Cloud-owned: catalog, price publication, recipes, role/permission definitions and
  centrally controlled settings arrive as versioned configuration changes.
- Server derives branch/device scope from enrollment credentials, not submitted
  branch IDs. Devices cannot sync another branch's rows or global users.
- Stable operation IDs, device sequence, payload/schema version, inbox deduplication,
  ACK-after-commit, persisted cursors, bounded batches and retry backoff are mandatory.
  Test lost ACKs, reordered/repeated batches, server restarts and network flaps.
- Historical sale quantities/prices/taxes remain frozen; a new published price
  cannot rewrite an offline receipt. Never use blind last-write-wins for money.
- Cross-branch transfers and central financial operations need explicit ownership
  and a pending/confirmation workflow; offline hubs must not invent global finality.
- Keep unresolved conflicts visible and recoverable. Never silently discard them
  or claim partial synchronization as complete.

### Printing and kitchen
Local kitchen events are delivered inside the branch without a cloud round-trip.
One execution owner per printer/branch, with durable print intents and stable IDs.
Cloud replay must not create a second physical print. A print with an ambiguous
physical outcome is shown for explicit authorized recovery, not automatically
resent under a promise of exactly-once physical output.
Retain the installed print program until a separately tested handoff is approved.
Do not run old and new sales/print consumers as independent active writers.

### Identity and offline authorization
Enroll each branch/device using scoped, revocable credentials. Never ship production
database passwords, a cloud service_role key or a global signing secret to clients.
Offline identity and permission leases need explicit expiry/revocation behavior;
cloud revocation cannot instantly reach an offline device. Define sensitive actions
that stay online-only or fail closed when offline authorization expires.
Secure local secrets/backup files and document what hardware loss recovery requires.

### Updates
Separate data synchronization from code and schema updates:
- Data: incremental, versioned, branch-scoped changes; no repeated full dumps.
- Application: signed/verified release metadata, compatible versions and staged
  download, then activation only outside payment/kitchen-send/print critical work.
- Schema: ordered migrations with app/sync protocol compatibility checks, backup
  and restore rehearsal. Do not blindly replay cloud migrations against the hub.
- Retain a last-known-good application. Destructive schema rollback is not assumed;
  support forward fixes or a verified compatible backup restore without losing
  unsent operations. Do not delete the outbox to make an upgrade succeed.
A disconnected older branch must be able to submit its supported operation version
before it is required to upgrade. Define minimum supported versions and recovery.

## Verification ledger
Planning-only review: inspected current GitHub sources above, identified two queue
paths and remote-UI dependency. No runtime implementation or installer is claimed.
Markdown/worklog checks are appropriate here; no production load testing or sales.

Required phases and exit criteria:
| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| A0 | Call/RPC/trigger/extension inventory, branch hardware diagnostic, sync ownership matrix and local-engine decision | Demonstrate representative sale, reversal and kitchen/print parity in an owned fixture; document semantic gaps before choosing SQLite vs PostgreSQL/runtime packaging |
| A1 | Isolated hub API, local database and locally served UI | Cold boot without internet, durable multi-client branch scope, crash recovery, authenticated LAN access and backup/restore |
| A2 | Local POS, shift, kitchen and print flows | Real multi-device races, partial quantities, discounts, returns, permissions and ambiguous print recovery; no cloud writes in the fixture |
| A3 | Cloud inbox/outbox and versioned config sync | Repeated delivery/lost ACK/restarts/reordering cause one committed business effect; foreign-branch denial and frozen financial history |
| A4 | Installer, repair and safe verified updater | Upgrade with pending operations, rejected/incompatible release, interrupted migration and recovery tests on Windows |
| A5 | Explicitly approved single-branch pilot | Reconciled orders/payments/stock and print intents through a full offline/reconnect cycle; verified rollback/cutback plan |
| A6 | Staged branch rollout | Pilot evidence reviewed, each branch enrolled/backed up, health and sync lag visible |

A0 must evaluate existing Postgres RPC/trigger dependencies against any proposed
SQLite adapter. Neither a business-logic rewrite nor a Windows PostgreSQL/Supabase
packaging strategy is accepted without executable parity evidence. Reuse existing
semantics where possible; do not choose an engine merely to produce an installer.

## Production gate
Current authorization activates this development track. A branch pilot, cloud
schema change, live credential enrollment or production cutover requires a concrete,
verified candidate and explicit release approval. No current branch is switched.

## Next action
Perform A0 first: inventory operational entry points and both queue callers,
produce a capability/ownership gap matrix and a reversible branch-hub prototype
boundary. No more personal-PC cloud-password reset/full-export steps for this track.

## Mandatory update protocol
This log and CURRENT_WORK_PLAN are the source of truth. Update them after decisions,
test results and releases. Distinguish files prepared, services started, data synced
and a proven operational pilot. Never call an empty local database a working backup.
