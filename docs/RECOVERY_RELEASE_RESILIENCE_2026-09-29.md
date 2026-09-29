# Recovery and Release Resilience — 2026-09-29

## Restore rehearsal
- Use an isolated Fresh/Test database only.
- Restore a representative snapshot there.
- Apply repository migrations forward to the current head.
- Run schema verification with `node scripts/db/verify-schema.js`.
- Run `npm run verify:full`.
- CI Full Verify uses an isolated PostgreSQL 16 service with `SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:5432/postgres`; this is the canonical Fresh DB verification path, not Production.
- Run `tests/integration/functional_core_cycle.test.ts`.
- Verify branch isolation, financial balance, and stock/kitchen consistency.
- Never use Production as the rehearsal target.

## Application rollback
- Roll the web app back only to a known-Green application commit.
- Do not automatically downgrade database schema.
- Re-run database identity, API parity, System Health, and live read-only branch checks.
- If a newer DB contract must be corrected, use a new forward-only migration.

## Migration recovery
- Applied migrations are immutable history.
- Correct problems with a new forward-only migration.
- Never edit applied migration files or delete migration history.
- Never rewrite historical business data only to satisfy tests.

## Print Agent recovery
Keep the latest independent branches:
- `development/cleopatra-v811-final`
- `development/smouha-v811-realtime-final`

Verify branch identity, printer routing, queue behavior, and cross-branch isolation independently from web rollback.

## Final recovery gate
- exact-head Fast Verify Green;
- exact-head Full Verify Green;
- Production API parity Green;
- Smouha/Cleopatra read-only safety checks Green;
- print queue healthy;
- explicit user approval before merge/deploy.

## Rehearsal evidence
Record the test target, repository commit, migration range, schema verification, Golden Path result, branch isolation result, financial reconciliation result, timestamps, and any corrective action.
