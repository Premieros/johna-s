# Print Queue Manual Controls — 2026-09-17

Approved scope: add manager-only safe retry and cancel controls to the station print queue introduced in PR #183.

## Safety rules

- Authorization remains Permission-First: `settings.manage` + branch access.
- Retry is allowed only for `failed` jobs whose outcome is known safe from duplicate printing.
- Retry is blocked for `PRINT_OUTCOME_UNKNOWN`, `PRINT_CALLBACK_TIMEOUT`, `PRINT_SEQUENCE_CHANGED`, and `INVALID_APPROVAL`.
- Cancel is allowed only while a job is `pending` or `failed`; it cannot cancel `claimed`, `printing`, `submitted`, or `printed` work.
- Retry/cancel never call order, payment, sale, kitchen, or inventory business mutations.
- Every manual retry and cancellation is written to `audit_log`.
- Cancelled jobs are terminal and are excluded from the active station queue.

## Production guard

No migration in this work is applied to Production from this branch. Full Verify must be Green on the exact final head, followed by explicit Production migration approval.
