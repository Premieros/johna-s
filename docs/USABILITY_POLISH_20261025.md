# Usability polish — 2026-10-25

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/usability-polish-20261025`
Current PR: #0 (not yet assigned during local preparation)
Last updated: 2026-10-25

## Work status
State: **BLOCKED**
Owner authorized implementation of the browser usability review. Release requires final approval after the verified candidate is reviewable.

## Guardrails
- Presentation only. No database, RLS, action permission, pricing, checkout, stock, transfer or kitchen/print writer changes.
- No additional queries, polling or dependencies. No production log scans, test orders or printing.
- Use the existing report snapshot and existing POS data. Keep manual report loading and frozen result context.
- Local Windows experiment remains isolated and unmerged.

## Baseline
Main `facb94776a7912ff39f807300d16548f1fd74251` (#535 deployed).
Browser review observed desktop and 390px mobile layouts using super-admin Smoha; original user tab was retained.

## Root-cause ledger
- Report filters and toolbars dominate the viewport; the table begins near the bottom, especially on mobile.
- Report family and view titles are visually disconnected. Browser fullscreen may be denied, leaving only an F11 hint.
- POS branch context disappears in the selling workspace; counters rely on icons. Small table-card metadata is difficult to read.
- Dispatch and payment terminology is conflated visually, despite distinct underlying business states. Cancellation is an unlabeled icon beside daily actions.
- Large dashboard welcome/calendar displaces operational indicators.

## Change ledger
- Collapse optional filters with an active-filter count; keep date boundaries and manual Run Report visible. Preserve all filter values and source requests.
- Expand reports inside the viewport with Escape/exit controls, preserving the mounted report and its loaded snapshot. Restore body scrolling on exit/unmount.
- Show report family plus selected view; wrap report actions on mobile. Normalize report display dates to Gregorian day/month/year with Cairo timestamp context, preserving ISO request boundaries and native date inputs.
- Show POS branch and operator; label counters; enlarge table metadata. Describe dispatch separately from the open bill, retaining the exact existing payment and kitchen guards.
- Label cancellation and separate it visually. Compact dashboard welcome and expose the existing calendar on request; preserve existing activity subscription and animation behavior.

## Verification ledger
- 46 focused tests passed before final test additions; app/test TypeScript and targeted ESLint passed.
- Existing stability tests continue proving no result requests on mount/filter changes and frozen report context before an explicit run.
- Added in-page expand/escape identity test and Gregorian/Cairo date tests. Added 320px/1366px report layout checks for existing mocked-browser CI.
- Final focused verification, build, exact-head full Verify and browser acceptance must be recorded in the PR ledger.

## Production gate
No merge or publication before final owner approval and exact-head checks pass. No production migration is part of this candidate. Rollback is a normal revert of UI commits; no data rollback.

## Next action
Finish focused verification and mocked-browser layout acceptance; publish draft PR and wait for required checks. Present the candidate for owner release approval.

## Mandatory update protocol
Check current main and branch before writes. Preserve original user data and unrelated local worktrees. Record exact final-head CI in the PR ledger; do not rewrite the tested head for release-only status updates. Keep automated log-scanning tasks disabled.
