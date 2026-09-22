# Auth/session stability repair — 2026-09-22

Branch: `development/auth-session-stability-20260922`
Base: `main`
Production DB: untouched
Printing: untouched
Migrations: none

## Reported symptom

- The site reloads repeatedly during active work.
- Some reloads send the operator back to the login page.

## Root causes found

1. `AuthContext.loadUser()` treated any `users` query error exactly like a missing/disabled application profile. A transient network/PostgREST error therefore cleared local auth state and called `supabase.auth.signOut()`.
2. `SessionProfileGuard` independently had the same behavior during background profile revalidation, so an already authenticated operator could be signed out because one profile query failed temporarily.
3. Stale lazy chunks after GitHub Pages deployments intentionally trigger a full-page recovery. The recovery marker expired after 60 seconds, which allowed repeated automatic reloads in the same working tab when deployments were frequent.

## Repair

- Preserve the authenticated Supabase session on transient profile query errors.
- Retry initial profile hydration with bounded backoff (1s up to 5s) instead of redirecting to login.
- Keep definitive fail-closed behavior for missing or inactive profiles.
- Keep RLS unchanged.
- Background profile revalidation retries after transient errors and signs out only when the profile is actually absent/inactive.
- Automatic stale-chunk recovery is capped to once per browser tab. Further stale-build events require the existing explicit refresh button rather than another surprise auto-reload.

## Safety boundaries

- No changes to printing, print agents, queues, receipts, POS business logic, inventory, shifts, permissions, RLS, migrations, or Production data.
