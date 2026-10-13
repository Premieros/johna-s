# Kitchen multiline and print branch recovery
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/kitchen-multiline-recovery-20261013`
Current PR: #499
Last updated: 2026-10-13
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED** until exact-head verification and deployment. Owner approved the print guard and publication at17:38:54 Cairo; guard application completed and verified at17:48. Production emergency rollback already approved at17:07 Cairo, applied version20261013140753, verified original four function bodies/OIDs/ACL/security and absent three optimization helpers. User confirmed multi-item send works again. Optimizations remain disabled.

## Guardrails
Only johnas. No unrelated project, physical test orders, prints, requeues, stock/accounting history reversal, agent reinstall, table/RLS/ACL changes or new SECURITY DEFINER bypass. Preserve original security modes and signatures. Report physical spooler handoff separately from actual paper delivery.

## Baseline
main aa3393af884986da3620c37d9bf74fc208cf84ce (#498). Applied activation20261013132245 was rolled back by20261013140753. Archive actual rollback statement verbatim; never reapply to production. Earlier GREEN CI did not cover the confirmed wrong selected-branch print scenario.

## Root-cause ledger
Confirmed: order Johna's-03231/table43 belongs to Cleopatra; job46190d8e-6216-4498-9332-f4e54de91dc2 at17:09:12 Cairo was enqueued to Smoha by current multi-branch operator and submitted by agent23bd9259-a414-4311-bf85-b7f11e359a33/account printer. Payload names Cleopatra's order. The kitchen service trusted workspace p_branch_id; enqueue RPC validated branch access and station, not source-order branch. Source send IDs were no longer present after subsequent void/cancellation; joining only current sends missed the historical incident.
Confirmed code defects: hydration depended on feedback callback identities and could overwrite local cart changes; stale pending loads lacked a cart revision guard. A newly persisted order ID was discarded by the client when kitchen send failed, so retry could attempt duplicate creation/TABLE_BUSY. Tests reproduce these states. Immediate/server-persisted deletion is NOT claimed: unsaved edits are committed by existing save/send flows.
SQL optimization cause remains unconfirmed: two distinct products/nine materials send succeeded in a disposable WASM PostgreSQL clone. Canonical dependencies match live fingerprints except a non-kitchen inbound overload. Do not re-enable optimization based on that passing reproduction.

## Change ledger
Keep emergency rollback canonical in CI; remove automatic CI re-binding of rolled-back optimization. Preserve cart edits across callback refresh/late reads; adopt saved order identity before kitchen RPC result. Print from authoritative order branch returned by RPC, with one indexed legacy lookup only when missing. Missing source branch refuses routing; local fallback disabled when selected branch differs. Add order_id to ticket payload.
Review SQL changes only existing enqueue/send wrappers: source-order branch validation for new order_id and old normal order-number tickets; return already-read branch_id in send result. Original OIDs/owner/ACL/search_path preserved. Generic non-order print payload compatibility retained; no print-agent changes. Production and repository enqueue originals differ only in whitespace; both exact hashes reviewed, remaining metadata checks exact. No activation authorized solely by this worklog.

## Verification ledger
Local: three cart recovery cases, four routing behavior cases; source/retry compatibility assertions retained. Four isolated SQL cases reject cross-branch tickets even for super admin, support old text-only tickets, preserve correct-branch idempotency and unchanged function security. Full native PG16/Chromium CI required before merge. Scratch WASM harness is supplementary, not concurrency/performance evidence.

## Production gate
Emergency rollback approval satisfied and completed. Print branch guard remains a concrete review package; apply via migration API only after owner approval, catalog verification, tested barrier. Archive actual generated version/statements immediately; never invent migration version. Tell owner before merge. Optimization reactivation forbidden until root cause and dedicated regression are resolved.

## Next action
Finish exact-head native CI, review and deploy source-order routing/guard, verify natural print delivery without reprinting. Investigate original multiline optimization failure separately; don't confuse restored service with a proven permanent optimization fix.

## Mandatory update protocol
Fresh exact branch HEAD before every sequential GitHub mutation. Stop on drift. Freeze source writes while exact-head checks run. Record actual production version and observed effects; pending is not success. No agents or parallel writers.


## Approved production print guard result
Owner approval2026-10-13 17:38:54 Cairo covers guard and publication after verification. Actual migration `20261013144819_kitchen_print_source_branch_guard_20261013` applied successfully and archived verbatim (3738 characters). Expected source bodies compared byte-for-byte after application: enqueue aa538c1253cf9a4232ccbf89ee82b7cb; send wrapper a06c101f6eaa9c5f7209e0ff4280c05d. Original OIDs37484/40502, owner, ACL/search_path/security modes unchanged. All other public function fingerprints unchanged (21fa2b0f89d7e9238e9ab99e0a26113f), core remains d9d480eeaf2d1c3afecdac1666e3a0bd and optimization helpers absent. No production test/reprint or agent installation. Do not reapply this migration to production.
Acceptance before archival HEADd19742b7eb21ff90ceec53d58669fd73ed7e14d2: Fast38414403919 GREEN; Full38414407225 GREEN (1715frontend,1042DB/RLS,132Chromium); Windows38414406882 GREEN. New exact-head archive replay checks required before merge. Worklog's pending-owner gate above is historical; approval is present. Notify owner before the authorized merge, then verify deployed assets and natural print routing.
