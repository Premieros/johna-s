# Modal scroll and mobile navigation
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/modal-scroll-mobile-navigation-20261012`
Current PR: #496
Last updated: 2026-10-12
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED** for production until exact-head Full Verify and owner approval.

## Guardrails
Frontend presentation only. No production data, SQL, orders, kitchen sends, printer tickets or financial changes. Current user reports follow-up modal/mobile navigation failures after #495.

## Baseline
Main c9247e696c31c662328ac3e83887726877b457f2. #495 exact-head Verify 38272593542 and Pages 38274080699 succeeded. Postmerge Verify 38274080787 still running at scope transition. No unexpected main changes.

## Root-cause ledger
Independent save/restore body overflow in each Modal is unsafe if nested dialogs close out of order. onClose callback changes recreate the old effect, compounding lock ownership instability.
Dialogs rendered inside constrained ancestors can inherit transform/clipping context. Portal to body removes that ancestor constraint.
Fullscreen progress intercepts navigation while route/auth data loads. Compact pointer-events-none status preserves busy feedback without intercepting controls.
Native phone touch behavior still requires device validation; Chromium viewport success alone cannot prove iOS gestures or keyboard behavior.

## Change ledger
Ownership-based shared scroll lock restores original body overflow only after last dialog closes; release idempotent. Stable effect uses latest close callback, Escape only closes top owner.
Shared Modal portals to document.body, bounds and clips panel, scrolls body independently, allows native pan/zoom. Remove backdrop blur and all-property close-button transition.
Global progress uses compact top status, retains bilingual copy/percentage and lifecycle; remove unused animated mark.
Plan selects this single frontend branch. Read-only kitchen pressure investigation stays separate; no kitchen implementation included.

## Verification ledger
Local Node test against exact helper source passed both nested close orders, top ownership, original overflow and repeated release.
Component regressions cover nested lifecycle, latest callback/top-only Escape and portal ancestry.
Browser regressions on 390px and 1366px use mocked categories: long dialog wheel scroll, page stays stationary, close restores body overflow and active-order navigation works. No real API mutations.
React review: stable effect dependencies/cleanup, latest callback ref, no new fetches, existing dialog semantics/labels maintained, native gestures, bounded scroll. No SSR in this Vite SPA.
Local full tests/browser unavailable: runtime lacks React/Vitest and Chromium executable; no such success claimed. CI required on final head.

## Production gate
Exact-head Full Verify green and owner approval required before merge/deploy. User approval for #495 does not apply automatically to #496.

## Next action
Inspect CI and resolve genuine failures. Validate actual phone gesture, keyboard and navigation as remaining device acceptance. No blanket guarantee for custom dialogs that do not use Modal.

## Mandatory update protocol
Read exact HEAD before every sequential write; stop on unexplained changes. Record real results. No cosmetic commits during exact-head verification.
