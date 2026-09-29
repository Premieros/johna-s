# TREASURY BUSINESS-DAY CHAIN RECONCILIATION

Repository: Premieros/johna-s
Branch: development/treasury-business-day-reconciliation-20260929
Status: BLOCKED from merge until exact-head verification and approval.

Root cause: Treasury daily reconciliation used calendar dates while branch operations use a configured business day beginning at 08:00 and continuing after midnight. This created artificial differences between shift net and treasury day net.

Required chain:
- Employee handover equals canonical calculated shift cash net.
- Counted cash is informational only.
- Sales, purchases, expenses, transfers, and journal cash movements use the configured business-day boundary.
- Opening cash + daily cash net = closing cash.
- Closing cash of one day = opening cash of the next day.
- Latest closing cash must reconcile to current branch treasury cash.
- Purchases or expenses already included in shift net must not be deducted twice.

Verified read-only findings:
- Cleopatra business day starts 08:00 and ends 02:30.
- Smouha business day starts 08:00 and ends 03:00.
- Cleopatra 2026-09-22 and 2026-09-23 reconcile exactly after business-day rebucketing.
- Cleopatra 2026-09-21 has genuine pre-shift purchases/expenses that must not be attributed to the employee.
- The 527.20 purchase inside the 2026-09-21 shift is already included in shift cash net 6478.26 and must not be deducted twice.

Branch changes:
- Added business-day chain reconciliation migration.
- Removed the misleading outside-shift cash column from Treasury UI.
- Added regression tests for business-day bucketing and carry-forward.

Safety:
- No historical financial data mutation.
- No printing, Print Agent, KDS, or routing changes.
- No merge or Production migration without exact-head Green and explicit approval.
