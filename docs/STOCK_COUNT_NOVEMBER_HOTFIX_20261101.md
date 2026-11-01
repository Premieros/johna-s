# November stock count UI hotfix — 2026-11-01
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-prior-month-ui-block-20261101`
Current PR: #567
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
Owner requested immediate deployment to allow new November counts while branches open. Existing approved Oct documents block the browser form. Code-only candidate staged.

## Guardrails
Never auto-apply, cancel, reject or relabel October count #00006/#00007. Never rewrite stock, ledger or financial history. Do not bypass inventory.count.create or apply permissions. Require green four-job exact-head CI and production Pages confirmation.

## Baseline
Main has October approved counts; production create_stock_count RPC does not enforce one active count. Frontend StockCountsPage.tsx does block when any old approved count exists. User provided screenshot of this exact client-side error.

## Root-cause ledger
UI counts.find rejects any approved count for the same warehouse regardless of age. Approved old documents are October, and current time is November. Distinct unresolved question whether original counts posted through alternative paths; do not infer posting solely from status.

## Change ledger
Change UI guard to exclude prior-month approved records from the current-month new-draft blocker. Leave draft/submitted blockers and same-month approved blockers intact. No production SQL.

## Verification ledger
First exact-head run 41278455907: database, browser and Pages-continuity jobs passed; verify failed mandatory active worklog branch-mismatch assertion. Updated the unified plan and created this dedicated branch worklog to restore the required CI gate. Fresh exact-head CI required.

## Production gate
BLOCKED until exact-head full Verify main four jobs success; merge must be followed by actual successful Pages deployment on main. This is a UI-only operational release, not proof historical count reconciliation or successful financial application.

## Next action
Run exact-head CI then merge if all checks green, confirm GitHub Pages deployment and instruct operators to refresh safely while preserving their currently unsaved count.

## Mandatory update protocol
Update this ledger after each material code or CI result. Do not weaken tests or permissions. No Merge ولا Production migration before the relevant release gate.
