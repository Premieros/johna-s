# Johnas SQL activation — approved 2026-10-13 15:03 Cairo
Repository: Premieros/johna-s
Production: azzdesuowpdcoflmyezn
Branch: development/kitchen-sql-activation-20261013
Execution: SINGLE_WRITER / SEQUENTIAL_ONLY
User explicitly approved SQL activation after being told merge did not activate it.
#497 merged at19017adedb473371d76c1601159568aa8034f5ff and Pages/postmerge verified GREEN.
Canonical fingerprints still match original baseline; two live read snapshots had no active client transactions. Neither snapshot alone enforces quiescence.

Activation uses the already-tested self-contained forward package and SAME-TRANSACTION barrier in scripts/rollout/kitchen_activation_barrier_20261013.sql. EXCLUSIVE NOWAIT on operational parent/raw accounting tables rejects existing writers and holds new writers until commit while permitting plain reads. Printing queue/agent tables are not locked or changed. No table/RLS/ACL/schema redesign. This is a brief write barrier, not a claim of zero delay for stock operations.

Owned CI now exercises forward/rollback with that exact barrier; an active order writer must reject it with55P03 and preserve function definitions/stock; a new authenticated send waits behind the barrier, plain SELECT remains usable, then completes with exactly one deduction after release.
Require new exact-head Fast/Full success before activation. Restore code on validation mismatch, never reverse committed business history. Archived rollback remains guarded.

Production DDL must use the project's migration API, preserve migration-history identity and reconcile the applied generated version back to repository history before considering rollout complete. Do not rerun recovered historical migrations. Production apply still PENDING; no live SQL changes yet.
