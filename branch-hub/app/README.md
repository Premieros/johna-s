# Actual application local build — readiness only

Build from the repository root:

    npx vite build --config branch-hub/app/vite.local.config.ts

This compiles the original application and its existing AuthContext and POS routes.
Only this build substitutes the Supabase client and removes the cloud support widget.
The production configuration and client remain unchanged.

The local client requires a same-origin `/local-config.json` with protocol `1`,
mode `readiness-only`, the enrolled T.B.S branch UUID, and a local public anon JWT.
It never accepts a backend URL or a service-role key. Requests use `/local-api`
on the loopback origin and refuse redirects. Browser CSP blocks external resources,
including cloud connections, remote fonts, widgets and remote printing services.
No configuration containing credentials is included in this source tree.

This is not an installer or a working local backend. Do not point its gateway at
production or enable sales. The next integration must supply actual local GoTrue
and PostgREST, authenticate real local users, enforce branch enrollment server-side,
and gate business writes through the atomic operation inbox/outbox. Client-side
configuration validation is not authorization. No fake sessions or CI Auth fixtures
are included. Real login, refresh, permissions, POS rendering, business commits and
restart recovery still require end-to-end verification against that backend.

`gateway.mjs` now provides the HTTP boundary for this build. An enrollment host
can call `createReadinessGateway` and bind the returned Node server to 127.0.0.1.
It accepts only literal loopback HTTP upstreams, exposes only the public descriptor,
forwards password/refresh/logout/user routes and direct table reads, and refuses
all RPCs, business writes, signup and Auth administration. It forwards the caller's
bearer token to the real backend without inventing sessions. The backend must
validate it and enforce the real canonical RLS; the gateway is not an Auth server.
No permissive backend or production configuration is supplied.

Tests use an explicit loopback HTTP fixture to verify transport and denial behavior.
They do not prove actual GoTrue login, business permissions or POS usability. Missing
services yield a generic unavailable response; there is no cloud fallback. Upstream
redirects are refused, browser origins checked, payloads bounded and static symlink
escapes denied. PIN lookup RPCs remain deliberately unavailable pending a reviewed
server-side enrollment/authorization path.

LAN access and automatic cloud synchronization are not enabled by this build.
