# Finance low-read repairs
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/finance-low-read-20261021`
Current PR: `530`
Last updated: 2026-10-21

## Work status
State: **BLOCKED**
Owner requested all three follow-up repairs with minimal database consumption.

## Guardrails
No production mutation during preparation. No tables, indexes, triggers, RLS changes, SECURITY DEFINER, sale/print/stock/ledger writers or Windows agent changes. Views use security_invoker and SELECT-only grants.

## Baseline
Main 453b2de6aa3076790e02c4b6533d1bea557e2cd5 (#529 deployed).

## Root-cause ledger
Offset histories can repeat/skip rows after insertions and lack an id tie-breaker. Customer invoice rejection leaves stale open amount. Invoice reads transfer paid history and stop after 5000 source rows.

## Change ledger
Opt-in created_at/id keyset for three financial histories. Two security-invoker views filter outstanding invoices server-side; 100 invoices + one lookahead per manual request, UUID cursor, no automatic loops or count query. Opening/aggregate payment remains available; partial invoice list is explicitly labelled. Customer rejection updates open from the same server response with no extra read.

## Verification ledger
24 focused assertions passed; application/test typechecks and targeted lint passed. Canonical DB/security and exact-head CI pending. Existing supplier/customer indexes verified read-only; no claim of zero reads or measured peak CPU improvement. No live transaction or production SQL.

## Production gate
State: **BLOCKED**
No Merge ولا Production migration before separate final owner approval.

## Next action
Verify isolated fixtures, RLS parity and exact-head release gates; present concrete PR.

## Mandatory update protocol
Reconcile main/head before mutations. Preserve scope and authoritative finance errors. Never retry an ambiguous financial write.
