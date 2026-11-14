# T.B.S original application and local HTTP boundary

Scope: draft PR 639 in Premieros/johna-s only. No deployment, production SQL,
branch activation, database password reset, print-agent changes or cloud export.

The original application now has a separate Vite build with an isolated client,
loopback-only descriptor, separate Auth storage namespace, no external fonts or
support widget, CSP, and no production URL fallback. Cloud source configuration
is untouched. Build output checked for the local client and absence of the
production Supabase endpoint.

The readiness gateway routes only password/refresh/logout/user requests to an
explicit loopback Auth backend and direct GET/HEAD table reads to an explicit
loopback REST backend. It does not manufacture tokens, user identities, roles or
sessions. Local peer/Host/Origin validation, redirect refusal, payload limits,
header filtering, generic upstream errors and static symlink containment are tested.
All RPCs, signup, Auth administration and business writes remain denied. Canonical
RLS and server-side branch enrollment are still mandatory before actual use.

Local verification: 14 native tests passed, zero skipped. These include gateway
integration over actual loopback HTTP, failed upstream behavior, cloud upstream
rejection, blocked writes, preserved bearer forwarding and escaped-file rejection.
The upstream fixture is a transport test, not GoTrue and not proof of real login.
The original local application build and build-isolation assertion passed.
CI now rebuilds and checks that isolated output on every branch-hub PR change.

Outstanding: actual local GoTrue/PostgREST provisioning and credential custody;
canonical schema installation without CI Auth stubs; enrolled users and offline
authorization policy; real login/refresh/logout and original POS end-to-end tests;
native database atomic inbox/outbox connection before any sale write; printer/KDS
ownership; LAN TLS/access policy; conflict-aware cloud sync and installer/update
integration. The existing PGlite recovery experiments do not yet supply this HTTP
backend. The gateway is not an installer or a complete branch runtime.

T.B.S stays inactive; existing branches keep the cloud path until individually
installed, verified and explicitly cut over.
