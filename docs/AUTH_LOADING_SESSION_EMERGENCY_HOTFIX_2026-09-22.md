# Auth loading / expired-session emergency hotfix — 2026-09-22

Branch: `hotfix/auth-loading-session-recovery-20260922`
Base: latest `main` at branch creation
Production DB: untouched
Migrations: none
RLS/permissions: unchanged
Printing: untouched

## Production symptom

Operators reported that protected pages could remain on the full-screen loader for a long time and then surface the Arabic session-expired / sign-in-again message.

The visible URL also contained the one-time stale-chunk recovery marker (`__refresh`), but the persistent spinner was traced to auth/profile hydration rather than printing or page-specific business logic.

## Root cause

The previous session-stability repair correctly stopped transient PostgREST/network failures from signing an operator out, but its retry branch treated every profile-read error as transient.

That included real authentication failures such as:
- HTTP 401;
- `AUTH_REQUIRED`;
- expired/invalid JWT responses (`PGRST301` / JWT claim validation).

As a result, an expired/rejected access token could enter repeated profile hydration with `loading=true`, causing ProtectedRoute to render the full-screen loader indefinitely instead of refreshing the token or ending the invalid session cleanly.

The global duplicate-query layer also kept a 1.5 second completed-response microcache. Although keyed by authorization identity, retaining completed PostgREST responses is unnecessary during an auth incident, so the hotfix removes completed-response reuse entirely.

## Repair

1. Added explicit auth-session error classification.
2. On an auth/profile 401/JWT/AUTH_REQUIRED failure:
   - attempt `supabase.auth.refreshSession()` once;
   - retry profile validation with the refreshed session;
   - if refresh or the refreshed auth validation fails, clear/sign out cleanly instead of retrying the loader forever.
3. A previously verified operator stays mounted during genuine transport errors; background retry no longer forces the full-screen loader for that operator.
4. SessionProfileGuard follows the same refresh-on-auth-error rule.
5. PostgREST deduplication is now **in-flight only**:
   - identical concurrent GETs can still share one request;
   - completed responses are never cached/reused;
   - writes advance the generation so a post-write read cannot attach to a pre-write in-flight read.

## Safety boundaries

- no Production database write;
- no migration;
- no RLS relaxation;
- no permission changes;
- no printing, print queue, receipt, station or print-agent changes;
- no POS payment/inventory mutation flow changes.
