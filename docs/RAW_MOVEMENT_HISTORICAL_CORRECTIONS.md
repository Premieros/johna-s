# Historical corrections for raw stock — Johna's

Keep one signed quantity ledger per branch, warehouse and material. Store the
effective movement time separately from when it was recorded. Current quantity
is a projection; reports must not add the projection and its ledger together.

- Draft documents: edit/delete without writing stock or journals.
- Posted documents: cancel with a compensating movement; edit by reversing and
  replacing in one transaction. Keep the original document and actor for audit.
- Historical counts: subtract the quantity at count creation from the physical
  count. Apply the resulting delta once to current stock. Reconcile the ledger
  through the cutoff and block coordinates with unexplained provenance gaps.
- A correction before a later applied count must respect that later physical
  count. Recompute downstream count variances on the affected coordinate only,
  rather than changing recorded sales, transfers or purchases.
- Keep quantity correction separate from valuation. Resolve the latest approved
  price consistently for the operation; use zero when there is no price. Store
  the price used so reversing a posting does not reprice the original journal.
- For closed accounting periods, retain the effective stock date and post the
  compensating financial entry to the appropriate open period under its policy.
- Make the request idempotent. Lock affected coordinates in a stable order,
  then recheck the source document, validate projection and journal parity,
  and commit together. Do not add a new full-history scan to sale or kitchen
  writes. Keep legacy outstanding debt reconciliation explicit until cutover.

Release checks: draft deletion, cancel/replacement of a posted purchase,
historical count followed by sale and transfer, two consecutive counts,
negative stock and open legacy debt, zero price, retry and concurrent sale,
cross-branch denial, and unchanged kitchen/printing behavior.

The historical raw-only count path is now wired through the existing public
permission/branch gate. Nine disposable-database tests cover zero valuation,
historical quantity delta, later sale preservation, full/partial debt offset,
retry, atomic rollback on quantity or account mismatch, a separate concurrent
writer lock, balanced journals, and a count shortage settled by a later receipt
without repricing the count. Effective movement time and valuation time are
separate parameters. Mixed/product counts retain the previous implementation.

Deployment still requires exact-head CI and production preflight. Neither count
has been posted by these tests. Existing sale/purchase writers retain their old
valuation behavior; this change is limited to raw stock counts. The compatibility
receipt change freezes only movements marked approved_last_known.
