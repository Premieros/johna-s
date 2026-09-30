# Emergency POS Line Identity / Print Dedupe — 2026-09-30

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/emergency-pos-line-identity-print-dedupe-20260930`
Current PR: `#421`
Last updated: 2026-09-30 18:38 Africa/Cairo
State: **BLOCKED**

## Work status
- Critical incident confirmed in Smouha and Cleopatra.
- Smouha order `Johna's-01525` contains duplicate Water rows and repeated kitchen deltas.
- Cleopatra reported repeated/garbled checks and table 41 instability.
- Code + DB hotfix implemented on PR #421.
- Production migration has only been exercised inside transaction + ROLLBACK; Production remains unchanged by this hotfix.
- First CI run failed only on mandatory worklog structure; runtime code was not evaluated in that run.

## Guardrails
- No direct write to `main`.
- No force push.
- No weakening RLS, permissions, branch isolation, or Super Admin behavior.
- No automatic rewrite of existing live customer quantities.
- No inventory reversal or financial correction is performed by this hotfix.
- Existing affected orders remain data-preserved until explicitly corrected through controlled POS actions.
- No Production migration before exact-head Full Verify is Green.
- Print Agent routing remains unchanged; only upstream line identity / delta correctness is being fixed.

## Baseline
- Main baseline at branch creation: `c1c0b4a72a8cf3a3e233a66f2d15081a931de12e`.
- Smouha affected order: `Johna's-01525`, table 50.
- Confirmed duplicate live Water rows on that order: two rows, each quantity 4 and each sent_quantity 4.
- Cleopatra affected order: `Johna's-01510`, table 41.
- Existing kitchen enqueue idempotency remains `kitchen:<station>:<delta identities>`.

## Root-cause ledger
1. Resumed cart rows carry `order_item_id`.
2. A newly selected identical product does not carry that ID.
3. `addToCart` compared `cartLineKey`, which uses `order_item_id` for resumed lines, so the identical addition was treated as a second line instead of incrementing the persisted line.
4. `cartToItems` dropped `order_item_id`, so `update_order` had no stable line identity and matched by configuration only.
5. With identical lines, persistence could map quantities to the wrong persisted row, causing false kitchen deltas and repeated/oversized kitchen tickets.
6. Receipt duplicate evidence also exists where an auto receipt and a later UI/manual receipt both produced distinct print jobs; that path remains authorization-controlled and is being kept separate from kitchen delta dedupe.

## Change ledger
- Carry `order_item_id` in cart payloads.
- Merge fresh additions into an existing resumed row by business configuration.
- Patch `update_order` to prefer exact `order_item_id` and reject identity mismatch instead of silently swapping rows.
- Include unit price and normalized modifier identity in fallback matching for older clients.
- Add unit contract coverage that locks these behaviors.
- Keep kitchen print routing, print agent, inventory deduction, KDS station mapping, payments, and shifts unchanged.

## Verification ledger
- Production migration parse/apply inside transaction + ROLLBACK: ✅
- Exact affected Smouha order transaction test: adding +1 to one Water line then calling `send_to_kitchen` produced exactly one delta line and did not move the other identical Water line: ✅
- First CI run #3550: ❌ worklog structure only.
- Worklog structure corrected: ✅
- Verify #3552: cancelled externally during test-suite typecheck after lint + app typecheck passed; no code failure recorded.
- Exact-head Verify rerun: pending.
- DB integration/security: pending.
- Browser Smoke: pending.
- Production API parity after deploy: pending.

## Production gate
Production application is blocked until:
- exact-head Verify is Green;
- DB integration/security is Green;
- Browser Smoke is Green;
- PR #421 is merged;
- migration is applied deliberately to Production;
- live read-only checks confirm no new duplicate-line / false-delta events in Smouha and Cleopatra.

## Next action
Rerun CI on the corrected worklog head. If Green, merge PR #421, apply the migration to Production, then inspect new Smouha/Cleopatra kitchen and receipt print jobs for duplicate deltas or repeated quantities.

## Mandatory update protocol
Update this log after every material code, verification, merge, migration, or Production-state change. Keep `State: **BLOCKED**` until every Production gate above is satisfied.
