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

LAN access and automatic cloud synchronization are not enabled by this build.
