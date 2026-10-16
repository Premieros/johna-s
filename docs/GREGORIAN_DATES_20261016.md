# Gregorian dates — 2026-10-16

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/gregorian-dates-20261016`
Current PR: 0 (pending creation)
Last updated: 2026-10-16

## Work status
State: **BLOCKED** — implementation requested; exact-head verification and separate production approval required.

## Guardrails
Presentation only. No DB, filtering boundaries, stored dates, timezone policy, stock, sale, accounting, kitchen or print transport changes. No new runtime dependency or database read.

## Baseline
Production #514 merge `e1c7f4ca4ee53a651170a19516fad7a0bfdd6cb6`; post-merge Verify 38882885956 all green. Rollback is a frontend revert to this baseline.

## Root-cause ledger
Shared formatDate/formatDateTime used ar-SA, whose default calendar is Hijri. Legacy health/waste/export date displays inherited the device locale. Native date inputs inherited language/direction from the Arabic document.

## Change ledger
Pin shared date/date-time displays to Gregorian with Arabic month names and Latin digits. Pin legacy default-locale dates to explicit Gregorian Arabic/English locales. Give shared and direct native date/datetime inputs an English Gregorian language hint and LTR direction; preserve ISO values, constraints and event handlers. Already Gregorian ar-EG/en date paths and print transport remain unchanged. Native picker appearance remains browser/OS controlled; no claim of overriding system calendars.

## Verification ledger
Targeted: 23 tests passed, including Gregorian Arabic year/month, leap day and ISO filter round-trip/min/max inside an ar-SA document. Typecheck, lint and build in progress. Full exact-head CI pending. Physical iOS/Android/Windows picker matrix not performed.

## Production gate
No merge/deploy authorized by this implementation request. Require exact-head green checks and explicit owner approval. No SQL migration needed.

## Next action
Finish verification, open the review PR, and report its exact tested head before requesting deployment approval.

## Mandatory update protocol
Keep one writer and this log aligned with the active branch. Reconcile unexpected main movement before merge. Record final CI and approval/release evidence in the PR body without modifying a frozen tested head unnecessarily.
