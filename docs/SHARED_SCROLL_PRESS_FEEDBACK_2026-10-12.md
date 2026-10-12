# Shared scrolling and press feedback
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/shared-scroll-press-feedback-20261012`
Current PR: #495
Last updated: 2026-10-12

Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED** pending exact-head Full Verify and browser validation.

## Guardrails
Frontend presentation only. No SQL, live orders, print jobs, transaction or stock changes. No production merge/deploy.

## Baseline
Main 6673da6db4dbd9db1e018131a3d7f15db978c022 includes merged #491. Compared commits since the old plan baseline against the kitchen log: changes correspond to the recorded approved Stages A/B, tests and documentation; no frontend change in that range. Current user explicitly changes scope to shared scrolling and press feedback.

## Root-cause ledger
Root html/body/root and app shell use overflow-x:hidden, which computes the other axis to auto and introduces nested scroll containers. This is a concrete CSS defect candidate, not proof of all reported stalls.
Shared Button animates all properties and some variants have no pressed styling. Native buttons/links outside it often lack visible press state.
Full-page route-loading overlay exists intentionally; retained until isolated navigation validation supports changing it.

## Change ledger
Use overflow-x:clip for root clipping and supported app-shell override. Keep dedicated POS overflow and modal scroll containment.
Add native :active brightness/outline feedback for enabled controls and manipulation gestures. No event handlers or business actions changed.
Shared Button uses short color transitions and pressed brightness/shadow instead of transition-all.
Plan changed to this single active frontend track.

## Verification ledger
Code inspected through GitHub connector. Local clone unavailable because git transport requires credentials; no local test/browser success claimed. Added real-shell browser regressions at 390px and 1366px for wheel scrolling both directions, held press feedback, action activation and scrolling after sidebar close. These use mocked application data and no production operations. Local browser launch unavailable (Chromium executable absent). Full Verify CI requested by PR. Windows/mobile actual scroll and action behavior still require browser checks before merge.

## Production gate
No merge until exact-head Full Verify green, actual browser scroll/press validation and owner approval.

## Next action
Inspect exact-head CI. Validate root scroll on mobile and desktop, horizontal tables, nested POS catalog/order scrolling, modal scrolling/close and navigation. Investigate remaining stalls rather than claim this removes JavaScript or network latency.

## Mandatory update protocol
Check expected branch HEAD before each sequential write. Record changed scope and actual verification; no unknown commits adopted. Stop writes during exact-head verification unless a failure requires correction.
