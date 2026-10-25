# POS order-type permissions — 2026-10-25
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/pos-quick-permission-boundaries-20261025`
Current PR: pending
Last updated: 2026-10-25

## Work status
State: **BLOCKED**
Owner approved preparing one capability per type for creation and dispatch. Production apply/release requires a verified reviewable candidate.

## Guardrails
Preserve installed printers, dispatch idempotency, order/item identities, transfer and costing algorithms, independent payment/edit/discount/receipt permissions, branch RLS and service-role paths. No log scans, production test transactions or role-name permission shortcuts.

## Baseline
Main `ff7a0f1b343227f5e96b62f032fb57b93d6a6eca`. New isolated worktree; unrelated work retained.

## Root-cause ledger
Legacy general creation implies takeaway in both UI and backend. Generic dispatch grants access to every order type. Production cashier role has quick_create + send_kitchen without general create, confirming the reported table-dispatch exposure. Production role list read once; no operational rows queried.

## Change ledger
Four explicit order-type capabilities: dine_in, takeaway, drive_thru, delivery. Each allows creation and dispatch only for its own authoritative type. Other actions remain independent. No generic permission may bypass type checks. Binding must reject takeaway with a table; type changes require destination capability. Plan conservative conversion: explicit legacy quick grants takeaway; legacy general create plus send grants dine_in/drive_thru/delivery. Do not infer quick from general create. Legacy send alone grants no type. Review exact role delta before rollout.

## Verification ledger
Pending focused UI and owned-localhost database allow/deny tests, exact-head CI and production fingerprint comparison. No fixes applied to production.

## Production gate
No apply/merge/deploy until candidate is verified and owner approves exact role mapping and database change. Preserve original function definitions and role permission arrays for guarded rollback; never restore unrelated later permission edits.

## Next action
Implement source and database authorization consistently, verify cross-type denials and unchanged independent actions; present the exact candidate.

## Mandatory update protocol
Single sequential writer, check HEAD before mutation, record final checks and exact production apply/release evidence without rerunning large suites unnecessarily.
