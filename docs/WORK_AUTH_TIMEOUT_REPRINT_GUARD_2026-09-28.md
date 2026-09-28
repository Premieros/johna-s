# Work Authorization Timeout + Receipt Reprint Guard — 2026-09-28

## Work status
State: **BLOCKED**
Last updated: 2026-09-28
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/work-auth-timeout-reprint-guard-20260928`
Current PR: `#400`

## Guardrails
- No direct write to `main`.
- No Production migration before exact-head Full Verify Green and explicit approval.
- Permission-First; Super Admin remains implicit bypass only.
- Print Agent executable, printer routing, KDS, kitchen printing, and frozen claim/start/complete RPCs are unchanged.
- No RLS weakening and no test weakening.

## Baseline
- Base main: `36fe875a3b14be17f908bb2d3015378922d0e50e`.
- Existing Production behavior: work-authorization pending rows can outlive one minute; direct `pos.reprint` can enqueue without an approval id and later fail in agent completion.
- Print Agent startup delay after Windows boot is treated as operational startup behavior and is outside this code change.

## Root-cause ledger
- Work authorization gate subscribed indefinitely while a request remained pending; stale server rows also remained actionable.
- Manager snapshot had no one-minute cutoff and decision RPC could approve an old pending row.
- Receipt enqueue respected `pos.reprint` during authorization, but frozen completion truth requires an approval row for every print after the first.
- The pre-payment Open Check button allowed repeated queue submissions, which made staff doubt whether printing worked.

## Change ledger
- Added 60-second work-authorization request TTL.
- Added sleeping gate state; after timeout there is no polling and no Realtime subscription until the user explicitly requests again.
- Added server rejection for approvals older than one minute and manager snapshot hiding of stale requests.
- Added direct-reprint internal approved token at enqueue time for users who own `pos.reprint`; frozen agent completion RPC is untouched.
- Added print-once guard only for the pre-payment Open Check; paid-sale receipt printing remains unchanged and still runs with every payment operation.
- Added a server-side Open Check guard so a refresh cannot create a second ordinary print; `pos.reprint` bypasses that guard.
- Added regression coverage for timeout, direct reprint token, Open Check print-once, manager reprint, and checkout/payment independence.
- Review caught and corrected a transient placement error where the Open Check lock had entered checkout opening; final code scopes it to pre-payment printing only. Automatic paid receipt printing is explicitly unchanged.

## Verification ledger
- Fast Verify #1151: **FAILED** on first pass.
  - App failure: mandatory worklog structure only.
  - DB failures: test fixture isolation + invalid empty thermal payload in the new regression test.
- Full Verify #3180: **FAILED** early because mandatory worklog gate failed.
- Fast Verify #1174 / Full Verify #3201 on head `201f8af5`: **DB GREEN**, App failed only because an existing component contract still expected the old combined print-button expression. The production code behavior was correct; the contract was updated to distinguish pre-payment Open Check from paid receipt.
- Fast Verify #1176 / `36402408963` on functional head `2e41ebad34c643a577ae73d4fed913e9bad84d93`: **GREEN** (scope + app + DB + summary).
- Full Verify #3203 / `36402421222` on the same functional head: **GREEN** (verify + Fresh DB/integration/security/RLS + browser-smoke).
- Production migration: **NOT APPLIED**.
- Runtime/Production data: unchanged by this branch.

## Production gate
- Functional implementation verification: **GREEN**.
- PR #400 remains Draft and mergeable.
- No Merge yet.
- No Production migration yet.
- User approval is still required for Merge + Production migration after this final scope correction.
- Functional code is ready for merge approval, but the mandatory worklog remains **BLOCKED** until the user explicitly approves Merge + Production migration.

## Next action
- Let the documentation-only exact-head Fast/Full Verify complete.
- If Green, report that the functional implementation is ready for explicit Merge + Production approval while the mandatory gate remains BLOCKED.

## Mandatory update protocol
- Update this log after every material code/test change or verification result.
- Record exact branch HEAD and workflow run numbers.
- Any unexpected `main` or branch HEAD movement requires STOP_AND_RECONCILE.
- Do not claim readiness until exact-head verification is Green.
