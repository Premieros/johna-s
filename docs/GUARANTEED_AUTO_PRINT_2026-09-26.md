# GUARANTEED AUTO PRINT — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/guaranteed-auto-print-20260926`
Current PR: `#378`
Last updated: 2026-09-26

## Work status
State: **BLOCKED**

## Guardrails
- Do not change Print Agent, printer mappings, routing, station codes, KDS, or realtime wake behavior.
- Preserve print authorization, single-print/reprint approval, and existing cloud queue RPCs.
- No direct changes to main.
- No Production migration is planned unless verification proves one is required.
- Automatic jobs must be idempotent to prevent duplicate physical prints.

## Baseline
- Base `main@e58705a34f200c5a2fbce2e80b710b180db8300e`.
- Production `receipt_auto_print=true`.
- Production evidence: recent sales completed successfully without a receipt job at sale time; receipt jobs appeared later only after manual printing.
- Production evidence: recent Cleopatra/Smoha shift closes had no Z-report job near close time.
- Manual receipt printing and manual Z-report printing can create queue jobs, proving the agent/queue path is operational.

## Root-cause ledger
- Auto receipt currently calls `buildReceiptHtml` then `openPrintWindow`; cloud enqueue runs inside a detached async path, so successful sale completion is not coupled to successful job creation.
- Shift close currently ends after `finishClose`; Z printing is a separate manual button only.
- Existing manual Z idempotency uses `Date.now()`, appropriate for deliberate reprints but not for automatic close printing.

## Intended model
- Successful online sale/settlement + receipt_auto_print=true => await one cloud receipt job before returning success.
- Successful shift close => await one automatic thermal Z-report cloud job.
- Automatic receipt key is deterministic per sale.
- Automatic Z key is deterministic per shift.
- Manual print/reprint flows remain unchanged and permission-controlled.

## Change ledger
- Added `enqueueAutomaticReceiptPrint` using the existing `enqueue_cloud_receipt_print` path.
- Automatic receipt command is awaited after successful direct sale and successful order settlement.
- Automatic receipt idempotency key is deterministic: `receipt:auto:<saleId>:1`.
- Browser/manual receipt printing remains unchanged.
- Added `enqueueAutomaticShiftZReport` using the existing report queue path.
- Standard close, close-with-open-orders, and force-close UI paths now enqueue one Z command after a successful close.
- Automatic Z idempotency key is deterministic: `zreport:auto:<shiftId>`.
- Manual Z and A4 buttons remain unchanged.
- No Print Agent, routing, station, printer-name, KDS, realtime, or database migration changes.
- Added unit contract coverage for direct awaited queueing and deterministic idempotency.

## Verification ledger
- Pending.

## Next action
1. Add direct awaited receipt enqueue helper using existing cloud receipt RPC.
2. Wire both completed-sale paths to that helper.
3. Wire both shift-close paths to automatic Z enqueue.
4. Add regression tests for awaited enqueue and deterministic idempotency.
5. Run Fast + Full Verify and stop before merge unless explicitly approved.

## Production gate
- BLOCKED pending exact-head Full Verify Green and explicit merge/deploy approval.

## Mandatory update protocol
- Verify branch HEAD before every repository write.
- Unexpected HEAD/main movement => STOP_AND_RECONCILE.
- Record every change and verification result here.
