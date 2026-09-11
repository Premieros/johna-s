# Purchase invoice edit safety contract

Scope: purchase invoice correction and inline raw-material creation.

- Completed invoices are corrected through `update_purchase_invoice` only.
- The RPC reverses the old invoice through the canonical purchase-return path, renames the returned revision for audit, and posts the corrected replacement with the original invoice number inside the same transaction.
- No frontend stock mutation is permitted.
- Branch is immutable during correction; warehouse is validated against that branch.
- Authorization is permission-first with `purchases.manage`; inline raw creation requires `raw_materials.create`.
- Raw-material code, name, and measurement unit are required for inline creation.
- Production is not modified by this branch before Full Verify Green and explicit merge approval.
