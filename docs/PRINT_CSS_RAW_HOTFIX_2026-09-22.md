# Critical print CSS/raw HTML hotfix — 2026-09-22

## Scope
Emergency operational hotfix for thermal output that physically printed CSS rules before the ticket body.

## Production evidence (read-only)
- Matching live queue job: `64183003-5d06-4c45-81b5-56284463489b`
- Kind/station: `kitchen / بار`
- Order: `Johna's-00453`
- Time in payload: `2026-09-22 14:27`
- Queue payload text was valid thermal text.
- Queue payload contained a valid fixed template: `version=1`, `kind=kitchen`, `paperWidthMm=80`.
- Therefore the corruption occurred after queue creation, at physical execution/render transport.

## Hotfix
For installed Electron execution only:
- Keep the fixed template in application/queue data and preview.
- Do not send template-generated HTML to the installed Electron bridge.
- Print the authoritative thermal text payload instead.
- If only a template is present, derive safe body text after removing style/script/noscript/svg nodes.

## Safety boundaries
- No Production DB write or migration.
- No cloud queue/RPC schema change.
- No printer routing/station change.
- No `electron/main.cjs`, `agent.cjs`, or printer config change.
- No KDS, send-to-kitchen, stock, payment, or shift logic change.
- Non-template HTML printing remains unchanged.

## Rollback
Base main before hotfix: `67943a445e8444e6c63ef2a382e7c2c9c056b6a6`.
Branch: `hotfix/print-css-raw-text-20260922`.
