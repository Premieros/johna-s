# Approved-price stock count candidate — refreshed on main
Repository: Premieros/johna-s
Branch: `fix/stock-count-approved-price-on-main-20261101`
Date: 2026-11-01
Status: **BLOCKED — source candidate, not production migration**

## Work status
Rebased the latest price candidate from PR #569 on post-atomicity `main` without retaining conflicting old worklog edits. Existing production atomicity fix is separate and already applied. No business data mutation here.

## Required behavior
For each raw material use last approved branch price as of the count creation date, retain known zero, and atomically reconcile valuation and inventory journal at the count warehouse. Preserve existing permission, branch visibility, historical transactions, and full rollback on failure.

## Current work
Candidate function (DO NOT DEPLOY), unit regex contracts, and transaction-rollback local integration fixture testing zero-value surplus and cost-bearing FIFO shortage with zero-value revaluation bridge.

## Blocking issues
No passing exact-head database integration CI yet. Source-only tests are not enough. Need prove ledger bridge doesn't misstate historical raw batch valuations or financial reporting, ensure the latest price engine has an authorized source at count time, validate end-to-end complete shortage and journal, and resolve test failures. PR #569 remains unmerged.
November count drafts #00008 and #00009 are not approved/applied. No production business writes.

## Next
Run exact-head CI, fix failures in disposable local DB, thoroughly review batch/ledger reconciliation. Only afterwards propose a production migration and approve/apply stock count using normal role-gated workflow. 
