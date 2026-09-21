# Professional Receipt Form — 2026-09-21

## Baseline / rollback
- main before this work: `d1ceb83acded33cde594706bae708df3a4a8ed8e`
- branch: `development/professional-receipt-form-20260921`

## Objective
Rebuild customer and kitchen receipt presentation as a clear, fixed, professional 80mm form without changing the print transport, queue, station routing, permissions, print authorization, or installed-agent protocol.

## Frozen safety boundaries
- No Production migration.
- No cloud print table/RPC changes.
- No printer routing or station changes.
- No `agent.cjs` protocol changes.
- No `printer-config.json` changes.
- Fixed payload stays `template.version = 1`.
- Existing `text` fallback remains unchanged.
- VOID formatting is intentionally out of scope.
- Existing Windows agent can continue running; only `template-print.ps1` is the local renderer file affected.

## Customer form
- 80mm approved width.
- fixed title block.
- bordered invoice metadata section.
- 4-column items form: QTY / ITEM / UNIT / TOTAL.
- stronger item-name and line-total typography.
- bordered totals summary with prominent TOTAL.
- branch/store address/phone/footer preserved in the same fixed-template data model.
- OPEN CHECK and completed receipt use the same professional form.

## Kitchen form
- fixed title block.
- large bordered station card.
- bordered order metadata section.
- quantity badge + large item name.
- modifiers separated clearly.
- notes inside a visible box.
- compact thermal layout retained without prices/totals.

## Preview parity
`buildReceiptHtml(..., { authorize:false })` now renders the same fixed template used by the print path. Preview cannot authorize, enqueue, or record a print.

## Windows compatibility
`template-print.ps1` is updated to match the Web/Electron fixed renderer. The installed service, routes, ports, printer mappings and agent protocol are untouched.

## Verification
Pending focused unit contracts + exact-head Full Verify before merge.
