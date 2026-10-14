# KDS visibility recovery — 2026-10-14
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/kds-unfinished-visible-20261014`
Current PR: #502
Last updated: 2026-10-14 20:36 Cairo

## Work status
Owner reports delayed/missing kitchen display and paper in Smoha and requests repair, with immediate rollback if the latest repair is responsible. Implement a frontend-only visibility repair and verify before publication.

## Guardrails
Only johna-s. No SQL/schema/functions/RLS changes, live test orders, print replays, inventory/accounting changes or printer-agent modifications. Do not equate submitted jobs with physical paper.

## Baseline
main ac88b0ce (#501). Read-only diff confirms #501 changed notification/monitor reads, not KDS age filtering, dispatch or agent execution. No evidence currently warrants reverting #501. Preserve a rollback ref before merge.

## Root-cause ledger
Production get_kitchen_queue uses orders.kitchen_sent_at ahead of per-item sent_at. UI removes cards from the default view at 40 minutes. New additions to an old order therefore appear only in the overdue tab. Confirmed eligible examples in Smoha: orders03354/table45,03328/table50,03363/table23,03373/table04. This proves a display issue, not the cause of physical print failures.
Read-only noon-to20:31 Cairo sample:108kitchen jobs submitted, maximum creation-to-submission12.319s. Current send identities/cumulative quantities match queue keys in the sampled interval. Does not prove every historical delta or physical print, nor time before send reached the server.

## Change ledger
Keep all server-returned unfinished cards in the default tab. Retain overdue subset as an optional filter and original elapsed age. No added query or changed refresh cadence. Add component coverage for an old order receiving new items and the40-minute boundary; update desktop/mobile browser expectations.

## Verification ledger
Targeted17component/unit checks passed. Full local suite:362files/1758tests passed, application/test typecheck passed, lint0errors(14existing warnings), production build passed. Browser test could not start because preview server fails with uv_interface_addresses in this environment; no browser pass claimed. First CI passed1758frontend/1048DB tests and131browser tests; one browser failure was an ambiguous Arabic completed-tab locator matching the new unfinished-tab name. Anchor the exact completed label; no application code change. Repeat exact-head CI before merge.

## Production gate
State: **BLOCKED** pending exact-head CI only. Owner explicitly approved upload to Premieros/johna-s, merge and publication at20:40 Cairo. Earlier publication approval block is resolved. Owner repair authorization is present; no additional database authorization is inferred. Emergency rollback of this frontend change uses the retained baseline ref and normal deployment without operational replay.

## Next action
Run local checks, publish emergency PR, complete exact-head CI, merge/deploy verified frontend correction. Continue print investigation; if physical print remains absent, obtain affected ticket/device spooler evidence without repeating it.

## Mandatory update protocol
Fetch main before mutation; reconcile drift; no direct main or force push. Record final checks in PR metadata without untested code commits.
