# Premier Production Safety Protocol

> Applies to all AI coding agents and human contributors working on Premier POS/ERP.
> Production is a live multi-tenant restaurant system. Safety and data integrity outrank delivery speed.

## Non-negotiable production boundaries

- Do not deploy, merge, run production SQL, change production settings, trigger real printer jobs, or modify live data without explicit, action-specific approval.
- Never install, update, replace, or require changes to the print agents running in restaurants without explicit approval.
- Preserve the existing public GitHub Pages URL, live kitchen and receipt printing, and operational Supabase Realtime subscriptions.
- Do not weaken authentication, authorization, tenant/branch isolation, RLS, order ownership, or financial invariants to improve performance.
- Do not treat a staging test, a queued/submitted print job, or a green CI run as proof of successful physical printing.
- Never use live restaurant printers or production data as a test fixture without explicit permission.

## Before editing

1. Inspect the current implementation, relevant history, and existing tests/CI gates. Do not recreate protections already present.
2. State the suspected root cause and confidence, impacted files/functions/tables, dependent flows, and the smallest viable change.
3. Classify risk: low (isolated UI/docs), medium (reports/read paths), high (orders, payments, inventory, permissions, printing, Realtime, schema).
4. Identify the focused tests and rollback/disable path before making changes. High-risk changes need integration/security tests and an explicit rollout plan.
5. Avoid unrelated refactors and simultaneous fixes.

## Efficient verification

- Run focused tests first, followed by relevant integration and security checks; respect existing CI requirements. Never skip a necessary test merely for speed.
- For changes to shared infrastructure or critical paths, run broader regression coverage.
- For printer changes, validate payload/protocol/transport separately and obtain actual paper confirmation when hardware behavior matters. Preserve idempotency; do not send duplicate test jobs.
- Use isolated staging with synthetic or anonymized data. Never let staging print to real restaurant devices.
- Report exactly which tests ran, their results, and what remains unverified.

## Release discipline

- Work in a separate branch and pull request. Never merge or deploy autonomously.
- Preserve existing GitHub verification and Pages deployment gates.
- Prefer additive, backward-compatible database changes. Review security, tenant boundaries, locks, and migration rollback before production changes.
- Use branch-scoped feature flags where appropriate; they do not replace database rollback or data recovery.
- Roll out incrementally only with explicit approval and a clear monitoring and rollback plan. Do not presume a test branch is safe to use without consent.
- For incidents, prioritize containment and restoration of service; avoid speculative production fixes.

## Observability and truthfulness

- Distinguish: request accepted, database committed, print job queued, agent submitted, and physically printed correctly.
- Watch errors, latency, order-to-kitchen handoff, print queues, and tenant-specific regressions without increasing critical database load.
- Never claim a fix is successful without matching evidence. Record remaining risks and operational validation requirements.

## Required response for every change

**Before:** root cause/confidence; exact scope; risks; targeted tests; rollback plan; approval required.

**After:** changed files and behavior; tests actually run; production status (unchanged unless explicitly approved); unverified outcomes; next safe action.

## Existing infrastructure

- The repository already has `verify`, `verify:full`, unit and integration test scripts.
- The GitHub Pages deployment workflow is gated on the `Verify main` workflow. Preserve and inspect these gates before proposing modifications.
- Do not promise a zero-risk release. Minimize blast radius, make changes observable, and prepare recovery.
