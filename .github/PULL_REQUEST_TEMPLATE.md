## Summary
Describe the smallest change and why it is needed.

## Premier safety review
For changes affecting orders, kitchen, payments, inventory, permissions, printing, database migrations, or CI, replace the placeholders below with specific details. The fast CI safety gate checks these fields before running the existing suites.

Impact: [Affected flows, branch/tenant isolation, and suspected root cause]
Verification: [Focused tests already run or planned; say explicitly what is not verified]
Rollback: [Safe disable or revert procedure, including irreversible database/data impacts]
Production status: No production changes

## Operational constraints
- [ ] Existing restaurant print agents and their deployment are untouched.
- [ ] Current GitHub Pages URL, operational Realtime, printing, and branch authorization are preserved.
- [ ] No production SQL, rollout, real printer job, or merge is included without separate explicit approval.
- [ ] Existing Verify main checks remain required; hardware results are not inferred from spooler submission.

> For a planned production operation, change Production status to "Requires separate approval"; PR approval alone is not authorization to operate on live restaurants.
