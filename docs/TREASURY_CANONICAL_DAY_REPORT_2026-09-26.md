# Treasury Canonical Day Closing Report — 2026-09-26

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/treasury-use-canonical-day-report-20260926`
Current PR: `#381`
Last updated: 2026-09-26 14:35 Africa/Cairo

## Work status

State: **BLOCKED**

UI-only fix prepared on a dedicated branch. No database migration is required. Merge is blocked pending exact-head Full Verify Green and explicit user approval.

## Guardrails

- Treasury UI only.
- Reuse the canonical day-closing report already used by Shifts.
- No database, RLS, accounting mutation, printing agent, KDS, routing, or send-to-kitchen changes.
- Do not edit main directly and do not force push.
- Permission-First remains unchanged.

## Baseline

- Branch created from `main@441faa3d3a5f67e9f75bb5e81ecad599c18c42d4`.
- PR #380 is already merged and its treasury reconciliation migration is applied to Production.
- Root issue: Treasury opened a custom raw-data modal while Shifts used `fetchDayClosingReportServer` + `buildA4DayClosingReportHtml`.

## Root-cause ledger

1. Treasury and Shifts called the same underlying business-day data source differently.
2. Shifts normalized the report through the canonical service and rendered the full A4 report.
3. Treasury rendered a separate raw key/value modal, creating a visibly different report.

## Change ledger

- Updated only `src/features/accounting/pages/TreasuryPage.tsx`.
- Removed the duplicate raw day-close modal.
- Treasury now calls `fetchDayClosingReportServer` and `buildA4DayClosingReportHtml`, exactly like Shifts.
- The button is labeled `تقرير إغلاق اليوم`.
- No DB migration or backend change.

## Verification ledger

- Pending exact-head Full Verify.

## Production gate

- Exact-head Full Verify Green: **PENDING**
- User merge approval: **NOT YET GIVEN FOR THIS PR**
- Production migration required: **NO**
- Merge allowed: **NO**

## Next action

Open PR #381, run exact-head Full Verify, and stop before merge for explicit approval.

## Mandatory update protocol

- Before every repository write, confirm the expected branch/head.
- After any code change, update the Change ledger.
- After CI, record the exact run/result.
- Keep State **BLOCKED** until exact-head Full Verify is Green and explicit merge approval is given.
- No Production migration exists for this fix.
