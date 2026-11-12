# Print status review and header alert removal
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/remove-print-alerts-20261112`
Current PR: `625`
Last updated: 2026-11-12
State: **DEPLOYED**

## Work status
Owner requests a printing health check and removal of the header printing-error button shown in the screenshot.

## Guardrails
Read-only production inspection only. Do not enqueue, retry, cancel, delete or reprint real jobs; do not change installed agents, printer routes, stock, sale or kitchen writers. Preserve permission-based approval notifications and decisions. No production sample orders or paper tests.

## Baseline
Main2bb14b0. The screenshot shows recovered submissions after retries, rather than current failed jobs. ApprovalInbox also reads/subscribes to print jobs to populate a separate warning-triangle button. This is independent of actual print execution and its settings monitor.

## Root-cause ledger
The warning button combines failed and recovered submissions, so resolved attempts keep appearing as warning-count items. Remove the button and its display-only print reads/subscription instead of hiding rows or changing print results. Use the approval queue's own retry flag to recover failed approval reads independently of printing events.

## Change ledger
Removed the header warning button, print-alert storage, print-job reads and print realtime subscription. Retained approval bell, review permissions, queue serialization, reconnect/focus recovery and decision errors. Failed approval reads now recover on the bounded existing30-second fallback even with a healthy subscription, without depending on print events.

## Verification ledger
Production inspection is bounded, read-only and uses existing indexes. A broad latest-by-created_at sample timed out at3 seconds; stop that shape and use the branch/status/next_attempt_at index for bounded queue sampling. No exhaustive history scans. Indexed sampling found no pending/claimed/printing jobs in either branch. Latest submitted cashier/bar/kitchen jobs in both branches completed on their first attempt; remaining failed records are historical (latest sampled Smouha Nov2, Cleopatra Nov3). A sampled Smouha cashier job waited11.77 seconds before claim and0.51 seconds from claim to submission; other sampled jobs waited0.37/1.18 seconds. This identifies a queue/agent acquisition delay in that sample, not slow spool submission; no evidence establishes its root cause or current physical device connectivity. The partial alert index confirms the screenshot's three Smouha recoveries at2026-11-11 20:34UTC: cashier attempts2 after~130s, two bar attempts3 after~357–358s. These are historical recovered submissions, not a current stuck queue. Prior failure reasons are cleared on successful completion; do not infer a root cause or reprint them. 30 focused tests passed across approval recovery, unchanged printer monitor, concurrent print reads/projection and existing permission/discount approval contracts. Application/test typechecks, targeted lint, API contract and worklog checks passed. Exact head e9856314a7411f16775d78d744e3a2307e0d8c5d passed full Verify main43174575831 and Fast Verify43174570612. Frontend2079 checks passed; both browser shards, database job and Pages continuity passed. PR625 merged at1770034f49539558846e4031e956068341bed5a7; exact-main Verify43175304767 and actual Pages43175894414 succeeded.

## Production gate
Owner authorizes removing the button. This candidate has no database migrations or operational print changes. Merge/publish only after checks pass; rollback restores the UI component without replaying print work.

## Next action
No pending runtime action. PR625 is merged and deployed at1770034f49539558846e4031e956068341bed5a7. Published HTML and served entry-module proof is recorded in the release PR body: exact source matches, printing-alert button absent, approval button present. Final indexed read found0 active and0 overdue jobs in both branches. Keep historical recovered/unknown-outcome records and installed print programs intact.

## Mandatory update protocol
Record actual status, limitations, test evidence and deployed source; never equate an OS submission with observed physical paper output.
