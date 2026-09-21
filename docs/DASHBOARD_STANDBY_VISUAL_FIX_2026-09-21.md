# Dashboard StandBy Visual Fix — 2026-09-21

## Scope
Visual-only refinement of the already-merged dashboard StandBy strip after live UI review.

## Base
- Repository: `Premieros/johna-s`
- Base: `main@074c2382d8277ec9e32e0dd0cd6694704cf8b3a6`
- Branch: `development/dashboard-standby-visual-fix-20260921`

## Changes
- True black StandBy surface instead of washed navy/purple.
- Higher-contrast vivid data colors:
  - bright white primary values
  - rose day/month accent
  - cyan branch/amount emphasis
  - amber date/document emphasis
  - green actor emphasis
- Removed welcome/branch truncation in the strip and allowed safe wrapping.
- Replaced the vertical/fade event animation with horizontal slide:
  - Arabic/RTL event enters right-to-left.
  - Idle calendar exits left.
  - Return transition reverses.
  - 280ms cubic-bezier transition.
- The StandBy viewport has a fixed responsive height.
- Both idle and notification states are absolute layers inside the same clipped viewport.
- Added CSS layout/paint containment and transform-only animation to prevent dashboard layout shift.
- `prefers-reduced-motion` remains supported.

## Safety
- UI-only changes.
- No database migrations.
- No print/Print Agent/cloud queue/KDS changes.
- No sales, payment, inventory, shift or accounting logic changes.
- No permission/RLS changes.

## Verification
- Updated the StandBy unit contract to lock:
  - fixed contained viewport
  - horizontal transforms
  - vivid high-contrast tokens
  - no welcome truncation
- Full CI pending.
