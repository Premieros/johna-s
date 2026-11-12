# Smouha report job parity with Cleopatra
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/smouha-single-report-job-20261026`
Current PR: #541
Last updated: 2026-10-26

## Work status
State: **BLOCKED**
Owner explicitly requested one task, then copying Cleopatra's behavior after being told this is a branch-specific DB enqueue exception. Production rollout authorized for this exact narrow fix after verification.

## Guardrails
One exact existing function-body block only. Preserve existing owner/ACL/security/search_path, permission guards, advisory lock, queue boundary normalizer, cashier route, immutable accepted-job dedup and response shape. No new SECURITY DEFINER, security relaxation, queue backfill/replay, operational writes, print agent/config, kitchen/bar or A4 changes. No production test print or log scans.

## Baseline
Main 950e5694f16b57b07f563c7c69a540c9c863c2ae. Production enqueue function definition MD5 c80ad7f4acf15aeb306716b8165cf4ff.

## Root-cause ledger
Smouha alone calls split_legacy_report_text, splitting at 320 characters or 12 lines and creating separate report jobs. Photo Z[1/4] through Z[4/4] matched four accepted jobs at 13:33:43 UTC on Oct26. Cleopatra already uses a single full-text array.

## Change ledger
Replace only the branch conditional with Cleopatra's existing one-element array. Keep the existing one-iteration insertion loop and response fields to minimize risk. Do not edit splitter or existing accepted pages. Function security properties are preserved via CREATE OR REPLACE of the captured definition, guarded by exact baseline hash. Guarded rollback restores just this block and rejects unrelated later changes. Historical split tests explicitly install their historical definition only inside owned-localhost rollback fixture; new tests exercise canonical single-job behavior for both branches.

## Verification ledger
Owned-localhost CI tests cover long Arabic text without truncation, one job, cashier route, same-key dedup, untouched legacy root/children, permission denial/branch isolation, guarded rollback/reapply and unchanged owner/ACL/security/settings. Type checks pending. No tests run against production queue.

## Production gate
Apply only exact tested SQL to johnas after all checks pass and baseline metadata still matches. Recheck complete expected definition and security metadata after apply, then merge/release. No production replay.

## Next action
Verify candidate and complete approved narrow rollout.

## Mandatory update protocol
Single writer. Record exact-head test and rollout evidence in PR ledger, avoiding status-only retests.
