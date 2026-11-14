# Johna's branch hub — isolated A0 preparation

This directory is **not imported by the web app or print agents**. It is not an
installer, local POS service, cloud replication client or completed offline system.
Production credentials and business data are not needed for these checks.

Run the isolated protocol checks with Node 22+:

```sh
node --test branch-hub/tests/*.test.mjs
node branch-hub/tools/audit-source.mjs --out /tmp/johnas-source-inventory.json
```

`tools/Check-BranchDevice.cmd` runs its adjacent PowerShell script on Windows.
Extract/copy both files into the same folder first. It writes only a hardware
report next to the script (or to an explicitly selected output path). It does not
install Docker/WSL, alter services/firewall, contact production, or collect login
details, IP/MAC addresses or printer names. Hardware results are **not** a readiness
certificate; executable engine/Windows/printing benchmarks remain required.

The source audit is lexical and reproducible, not a live schema inventory. Its
`from()` targets can include SDK storage targets; dynamic SQL, function overloads,
later ALTER/DROP statements and transitive dependencies require further review.

## Operation contract prototype

`prototype/operation-contract.mjs` preserves a detached immutable payload, origin
identity/time, operation ID, sequence and protocol version. Financial fractions
must be decimal strings rather than binary floating point numbers. It rejects
scope changes, oversized/non-JSON payloads, incompatible versions and reuse of an
ID with a different payload. A SHA256 digest is **not a signature/authentication**.

`verifiedContext` is a test seam for future server-verified enrollment and origin
identity. Never pass untrusted request claims as this context. Syncing on behalf
of the originating cashier will require an attested offline authorization record,
not replacing that identity with the sync worker's current login.

These tests do not implement database durability, atomic business/outbox commits,
inbox ACKs, sequence gap handling, business validation or actual financial replay.
No handler calls a production RPC. A real server must authorize each action and
recompute/validate its business effects; passing this envelope validator grants
no permission and proves no sale/payment/kitchen parity by itself.

See `docs/BRANCH_HUB_A0_20261114.md` for capability gaps and engine decision gates.

## Disposable schema compatibility probe

An optional development-only probe uses an externally installed PGlite 0.5.16:

```sh
node branch-hub/experiments/probe-pglite-schema.mjs /absolute/path/to/@electric-sql/pglite
```

It always creates a fresh in-memory database, uses the canonical CI Auth stub,
replays all migrations without skipping failed files, and closes the database.
It accepts a package directory, never a database connection string. It is not
part of the application, installer or cloud synchronization. See the A0 evidence
record for limitations; successful DDL replay does not prove business parity.

For a Windows **engine-only** synthetic trial with Docker Desktop, extract the
whole repository archive and run `lab/Run-Synthetic-Lab.cmd`. Read `lab/README.md`
first. It does not initialize or change the existing local Supabase database,
and does not supply a POS interface or synchronize branches.

The additional development-only `experiments/vitest.canonical.config.mjs` runs
17 unchanged canonical sale/split/refund/kitchen cases on a fresh memory database.
It requires root test dependencies plus `JOHNAS_TEST_PGLITE_PACKAGE_ROOT` and
blocks native pg clients. It cannot prove cross-client races, real Auth or data
survival after restart. It is separate from the seven-check Windows trial.

## Private A1 storage preparation

`runtime/operation-store.mjs` atomically records a registered business handler,
immutable inbox/result, pending outbox and device sequence in one owned database.
Authorization and receipt verification require explicit trusted callbacks. It
implements no HTTP listener, login, cloud transport or branch activation. Five
synthetic storage/process-kill checks and one original split RPC fixture exercise
the boundary. Read `docs/BRANCH_HUB_A1_STORAGE_20261114.md` for limits.

Existing branches continue using the deployed cloud application. Preparing or
copying these files must not redirect them or change installed print programs.

`runtime/backup.mjs` adds private authenticated encrypted backups and restore to a
new directory only. A canonical split-sale filesystem crash/retry fixture now
complements the synthetic ledger checks. Read the A1 backup record before use:
this does not supply Windows key custody, administrator restore UI or an installer.
No real branch/cloud data or credentials are used by these tests.
