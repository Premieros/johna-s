# Active FIFO paths — Johna's
Production identity: Premieros/johna-s / azzdesuowpdcoflmyezn.
Read-only catalog audit; no business operations run.

| Path | Current dependency | Replacement and gate |
| --- | --- | --- |
| Current raw valuation | Legacy valuation joins FIFO debt/lots | #585 reuses existing latest-price valuation, no new database API |
| Negative raw lot price estimate | FIFO issue/receipt/batch fallback trigger | This candidate uses the existing approved-price projection on insertion, preserves existing lot prices on update, zero when missing |
| Kitchen, sales, modifiers, production, adjustment, stock count, transfer, supplier return | Shared warehouse-aware _raw_remove_fifo and compatibility overload | Route once through the approved-price issue engine; physical batch selection remains for expiry and exact reversal. Verify each writer, including purchase-return cost semantics |
| Raw receipt / transfer in | _raw_add calls legacy FIFO settlement | Replace operational settlement only when opening quantity and accounting treatment are verified. Do not replay old sale costs |
| Ready products / adjustments / product count | _product_inv_remove_fifo and inline product batch costs | Determine the product's own approved cost source; raw material price cannot directly value an unrelated finished item |
| Legacy admin backfill / reversal | raw_fifo debt tables and settlement records | Preserve audited historical evidence; do not schedule or run a history rewrite |

The negative-lot candidate has exact definition guards. Its rollback is to restore the captured two definitions, with no data rewrite. Existing pricing-event RLS and function ACL are unchanged. This candidate does not change inventory quantities, sale COGS, payment, print, or automatic settlement. It is not installed by migrations. Open historical debt conversion and complete reversals remain production activation blockers for v2.
