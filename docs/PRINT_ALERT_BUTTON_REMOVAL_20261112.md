# Print status review and header alert removal
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/remove-print-alerts-20261112`
Current PR: `625`
Last updated: 2026-11-12
State: **READY**

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
Production inspection is bounded, read-only and uses existing indexes. A broad latest-by-created_at sample timed out at3 seconds; stop that shape and use the branch/status/next_attempt_at index for bounded queue sampling. No exhaustive history scans. Indexed sampling found no pending/claimed/printing jobs in either branch. Latest submitted cashier/bar/kitchen jobs in both branches completed on their first attempt; remaining failed records are historical (latest sampled Smouha Nov2, Cleopatra Nov3). A sampled Smouha cashier job waited11.77 seconds before claim and0.51 seconds from claim to submission; other sampled jobs waited0.37/1.18 seconds. This identifies a queue/agent acquisition delay in that sample, not slow spool submission; no evidence establishes its root cause or current physical device connectivity. 24 focused tests passed across approval recovery, unchanged printer monitor and concurrent print reads/projection. Application/test typechecks, targeted lint, API contract and worklog checks passed. Exact-head CI remains required.

## Production gate
Owner authorizes removing the button. This candidate has no database migrations or operational print changes. Merge/publish only after checks pass; rollback restores the UI component without replaying print work.

## Next action
Open the reviewed candidate; await exact-head CI, merge and observe verified Pages publication. Do not change installed print programs or their frozen contracts.

## Mandatory update protocol
Record actual status, limitations, test evidence and deployed source; never equate an OS submission with observed physical paper output.
