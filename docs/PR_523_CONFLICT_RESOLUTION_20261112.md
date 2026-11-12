# PR523 conflict resolution
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feature/live-support-consent-20261017`
Current PR: `523`
Last updated: 2026-11-12
State: **BLOCKED**

## Work status
Owner requests merge-conflict resolution. Retain the current main and original staged live-support changes; keep the feature OFF and the PR draft.

## Guardrails
No main merge, deployment, production schema or account/role change, remote sessions or messages. Preserve existing customer support, print agents, authorization, latest-price sources and RLS optimizations. Two-device acceptance and separate activation remain required by the original proposal.

## Baseline
Original head31a28b5ba5680eb9f81cd78b89ed15741d4dd671; merge main d7c7acc preserving both parents. Conflicts in App.tsx, CURRENT_WORK_PLAN and api-contract.json.

## Root-cause ledger
Main added AGENT/human customer support and new API calls. The old launcher must coexist with the new customer support; automatic merging also produced a duplicate support tab identifier.

## Change ledger
Preserve AgentCustomerSupport and the disabled SupportLauncher. Rename only the staged live tab to live_support so it cannot replace the existing support inbox. Regenerate the contract from merged source; keep the latest work plan with this candidate entry.

## Verification ledger
34 focused UI/protocol/permission checks and6 owned database consent/branch-isolation checks passed. Application/test typechecks, targeted lint, contract freshness and worklog checks passed. No production sessions or data were used.

## Production gate
Resolve conflicts only. The live-support proposal stays draft and disabled. No production activation or migration is authorized by this maintenance task.

## Next action
Update the original candidate branch with a two-parent main merge. Conflicts are resolved; retain draft and activation gates.

## Mandatory update protocol
Record final head and both-parent ancestry; never describe this candidate as published.
