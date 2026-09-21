# Performance Repair — 2026-09-21

Repository: `Premieros/johna-s`
Branch: `development/performance-repair-20260921`
Base: `main@e228162c308b365db0ba76ef31c5aa638462f5b5`

## Guardrails
- No direct writes to main; no force push.
- Production Supabase is `azzdesuowpdcoflmyezn` only.
- No Production migration until exact-head Full Verify is Green and explicit approval is received.
- Printing, Print Agent, printer routing, KDS, send-to-kitchen authority, payment logic, RLS and permissions are not redesigned in this work.
- Raw-material negative sell-through remains unchanged.

## Confirmed root causes
1. POS calls `get_pos_product_availability`, which calculates a maximum quantity per product by repeatedly calling `check_product_availability`. Production statistics showed this RPC as the dominant application query.
2. POS refreshes the same availability scan after inventory events and again after settlement although quantity is already not a client saleability gate.
3. Dashboard standby activity combines Realtime with a 5-second polling loop.
4. POS Realtime refreshes full active-order snapshots after table/order/item/send events; bursts can cause repeated snapshots.
5. Dashboard analytics loads large raw sale/item/payment row sets and aggregates in the browser.

## Repair plan
- [ ] P1: Introduce a lightweight POS sellability/configuration RPC: one diagnostic probe per product; stock shortages remain non-blocking, configuration errors remain blocking.
- [ ] P2: Switch POS to the lightweight RPC and stop inventory/settlement-triggered availability rescans.
- [ ] P3: Remove 5-second dashboard activity polling; keep initial load + Realtime.
- [ ] P4: Coalesce POS Realtime snapshot refresh bursts without losing a trailing refresh.
- [ ] P5: Reduce dashboard raw-row overfetch using server-side aggregation where contract-safe.
- [ ] P6: Add/update unit + integration contracts.
- [ ] P7: Full Verify exact head.
- [ ] P8: PR only after Green. Production migration remains unapplied pending explicit approval.

## Status
Started from exact latest main. No Production write performed.
