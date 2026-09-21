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
- [x] P1: Introduce a lightweight POS sellability/configuration RPC: one diagnostic probe per product; stock shortages remain non-blocking, configuration errors remain blocking.
- [x] P2: Switch POS to the lightweight RPC and stop inventory/settlement-triggered availability rescans.
- [x] P3: Remove 5-second dashboard activity polling; keep initial load + Realtime.
- [x] P4: Coalesce POS Realtime snapshot refresh bursts without losing a trailing refresh.
- [~] P5: Dashboard detail latency reduced safely: previous-period projection is narrower and payment/item detail queries now run concurrently. Further server aggregation will only be added if verification/profiling shows it is still needed.
- [x] P6: Add/update unit + integration contracts for sell-through, configuration blocking, no polling and Realtime coalescing.
- [x] P7: Full Verify exact head — run #2189 GREEN (verify + DB + browser-smoke).
- [x] P8: PR #293 is Green/mergeable. Explicit approval received; Production migration `pos_sellability_performance` applied successfully before merge.

## Status
Implementation head: `3a4a3f7e4b74bb0c4efda5ade22e6e698bbeff8b` before this log update.

Production migration status: **APPLIED WITH EXPLICIT APPROVAL** to `azzdesuowpdcoflmyezn` as migration `pos_sellability_performance` (recorded version `20260921120421`). Verification: function exists with hardened search_path; `anon` EXECUTE=false; `authenticated/service_role` EXECUTE=true; both live branches returned 249/249 sellable products and 0 configuration errors. Printing/KDS were not modified.


## Verification / benchmark
- Full Verify run #2189: verify ✅, DB/schema/integration/security/RLS ✅, Browser Smoke ✅.
- Read-only Production benchmark on 249 active products: legacy max-availability scan 1276.521 ms; one-probe diagnostic path 740.323 ms (~42% faster per scan), before counting removed repeat scans.
- `main` remained at `e228162c308b365db0ba76ef31c5aa638462f5b5` through migration verification.
