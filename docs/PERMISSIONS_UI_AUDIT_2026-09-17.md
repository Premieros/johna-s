# Permissions UI Audit — 2026-09-17

Branch: `development/permissions-ui-audit-20260917`
Base: `main` @ `21c076a5bb71cf860de28f80df45bff41e17eccd`

Scope:
- Wire user UI actions to `users.create`, `users.manage`, and `users.branches.manage` separately.
- Gate role-matrix mutation controls by `roles.permissions.manage` and role scope.
- Keep Super Admin as the only implicit platform-wide bypass in UI.
- Align database RPC authorization for `create_user` and `set_user_branch_access`.
- Remove obsolete hidden `products.assign` permission from role payloads during migration.
- Add regression coverage for granular permission behavior and UI wiring.

Safety:
- No direct changes to `main`.
- No Production migration applied by this branch work.
- No Print Agent changes.
- No mobile changes.
- RLS and Permission-First rules are preserved; database checks remain authoritative.
