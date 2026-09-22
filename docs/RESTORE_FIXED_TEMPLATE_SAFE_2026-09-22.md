# Restore fixed thermal form safely — 2026-09-22

## Incident
PR #315 stopped raw CSS/HTML from reaching thermal paper by forcing fixed-template jobs through plain thermal text on the installed Electron bridge. This removed the CSS failure but also regressed physical output to the old plain-text layout.

## Repair
1. Probe the existing localhost print service at `127.0.0.1:17654`.
2. If available, send structured `template v1` to its `/print` endpoint.
3. The local service renders the approved fixed form through `template-print.ps1`.
4. HTML is never sent to the Electron bridge for template-backed jobs.
5. If the localhost service is unavailable, retain the PR #315 plain-text fallback so CSS cannot return.
6. If a localhost template request becomes transport-ambiguous after dispatch, do not also print through Electron, avoiding a duplicate physical ticket.

## Boundaries
- No DB write or migration.
- No cloud queue/RPC change.
- No printer routing/station change.
- No `agent.cjs`, `electron/main.cjs`, printer config, KDS, stock, shift, or payment logic change.
- No reinstall is required for this frontend transport preference.
- Invoice prefix PR #317 remains separate and unmerged.

## Rollback
Baseline: `main@edc0512b590635a6fc694efe863bcb237bf2cbcb`.
