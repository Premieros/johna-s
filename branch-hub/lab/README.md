# Synthetic engine trial (not a local POS application)

Extract the **whole repository archive** first, then run `Run-Synthetic-Lab.cmd`
with Docker Desktop running in Linux-container mode. No Administrator launch is
needed. Initial image/dependency downloads require Internet. Keep the full source
folder together; do not run from inside a ZIP or copy just the CMD file.

The test container runs with `--network none`, read-only source/dependencies, no
published ports, no host Docker socket and no production environment variables.
Only disposable containers are started. Existing Supabase containers, databases,
credentials and branch settings are not changed. The test has a 2 GiB memory / 2
CPU limit; it can still make this computer busy. Do not run on an active cashier
computer. The Node image follows the Node 22 tag; the PGlite dependency is locked
at 0.5.16 with an integrity checksum. npm lifecycle scripts are disabled.

`synthetic-lab-result.json` contains schema results plus seven checks of the real
canonical `reconcile_offline_sale` function, using wholly fictional branch/user/
sale rows. Fixtures are rolled back and the in-memory database is discarded.
Financial decimals are passed as strings to PostgreSQL numeric parameters.

This only checks recovery of an **already committed** offline sale, including
retry/conflict/branch/anonymous-access boundaries. It does not prove creating an
offline sale, split payment, refunds, kitchen, printing, durability or real Auth.
It supplies **no POS user interface**, and is not a replacement for the existing
local Supabase database. pg_cron is absent from this embedded experiment.

The `.lab-deps` folder is a disposable package cache. A failure must not be fixed
by resetting cloud passwords, deleting database volumes, or switching branch URLs.
