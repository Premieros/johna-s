# ACCOUNTING CREDIT LABEL — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/accounting-credit-label-20260925`
Current PR: `#369`
Last updated: 2026-09-25

## Work status

State: **BLOCKED**

Small UI/accounting-label correction. Merge is blocked until exact-head Full Verify Green and explicit approval.

## Guardrails

- Single Writer only.
- No direct write to `main`.
- No force push.
- No Production migration.
- No printing / Print Agent / KDS / shift changes.
- Preserve permission/history visibility behavior.

## Baseline

- Base: `main@ba724149da4719e9005997e2725cbbd40a2879cc`.
- Global translation `credit` is used for the payment method "آجل".
- Accounting tables incorrectly reuse that generic payment label.

## Root-cause ledger

1. Accounting `credit` means **دائن**, not deferred payment.
2. `FinancialReportsPage` renders accounting headers with `t('credit')`, whose Arabic payment translation is "آجل".
3. Trial Balance header also depends on `ledgerIsAsset`, which can incorrectly turn debit/credit into inflow/outflow.

## Change ledger

- Trial Balance headers fixed to `مدين / دائن / الرصيد`.
- General Ledger and party accounting statement use `مدين / دائن`.
- Payment-method label `آجل` remains unchanged outside accounting.
- Added regression contract test.

## Verification ledger

- Pending.

## Production gate

State: **BLOCKED**

No database or Production migration is required. Merge only after exact-head Full Verify Green + explicit approval.

## Next action

Implement accounting-only labels and regression coverage, then run Full Verify.

## Mandatory update protocol

- Check branch HEAD before every write.
- Unexpected HEAD = STOP_AND_RECONCILE.
- Update Change/Verification ledgers after changes and checks.
- No merge while State is BLOCKED.
