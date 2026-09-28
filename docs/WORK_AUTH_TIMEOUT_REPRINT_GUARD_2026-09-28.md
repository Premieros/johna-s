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
- Completed-receipt UI did not reflect first-print consumption for users without `pos.reprint`.

## Change ledger
- Added 60-second work-authorization request TTL.
- Added sleeping gate state; after timeout there is no polling and no Realtime subscription until the user explicitly requests again.
- Added server rejection for approvals older than one minute and manager snapshot hiding of stale requests.
- Added direct-reprint internal approved token at enqueue time for users who own `pos.reprint`; frozen agent completion RPC is untouched.
- Added print-once UI lock for users without `pos.reprint`.
- Added regression coverage for timeout, direct reprint token, completed receipt lock, and Open Check lock.
- Review caught and corrected a transient placement error where the Open Check lock had entered checkout opening; final code scopes it to `printReceipt` only, so payment/settlement remains unaffected.

## Verification ledger
- Fast Verify #1151: **FAILED** on first pass.
  - App failure: mandatory worklog structure only.
  - DB failures: test fixture isolation + invalid empty thermal payload in the new regression test.
- Full Verify #3180: **FAILED** early because mandatory worklog gate failed.
- Production migration: **NOT APPLIED**.
- Runtime/Production data: unchanged by this branch.

## Production gate
- State remains **BLOCKED**.
- No Merge.
- No Production migration.
- Must obtain exact-head Fast Verify Green and Full Verify Green before requesting merge approval.

## Next action
- Run exact-head Fast Verify and Full Verify on the final code head.
- Confirm checkout/payment remains independent of print locks and frozen Print Agent paths remain untouched.
- If Green, report readiness and stop before Merge/Production migration.

## Mandatory update protocol
- Update this log after every material code/test change or verification result.
- Record exact branch HEAD and workflow run numbers.
- Any unexpected `main` or branch HEAD movement requires STOP_AND_RECONCILE.
- Do not claim readiness until exact-head verification is Green.
