# November draft stock count historical preflight
Scope: Johna's only (azzdesuowpdcoflmyezn), read-only. No posting, approval, backdating, or price changes were performed.

| Draft | Lines | Later movements (materials) | Opening snapshot mismatches | Variances with unsettled FIFO debt | Missing-price variance lines | Provisional signed value |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 00008 Smouha | 407 | 133 | 2 | 72 | 34 | 295235.40 |
| 00009 Cleopatra | 402 | 167 | 0 | 75 | 22 | -878789.13 |

Both drafts are dated November 1, 2026; authoritative requested cutoff is stock_counts.created_at, not an invented counted_at. Both have zero posted inventory/journal rows. At that instant use the approved branch source and zero for genuinely missing prices. Preserve all subsequent stock movements; a matching net is necessary but insufficient to establish complete event provenance.

Do not call the live-balance apply RPC for these drafts. Two Smouha mismatches are marshmallow +5 and guava +3 when reconstructing from current batches minus later ledger. The largest monetary anomalies are Cleopatra foil: 4002 book units, zero counted, approved unit cost 230 (two physical lots with costs 240 and 1.55); Smouha minced meat: -1075.28 book, 1.93 counted, approved unit cost 350. These are review flags, not confirmed corrections. There are 119 Cleopatra and 141 Smouha zero counts against positive book balances. Do not treat uncounted as zero or change price/UOM without source evidence.

Release gates: reconcile both snapshot mismatches; verify zero-count and unit provenance; preserve later quantities; establish non-replay treatment for legacy debt and validate closed-period, exact rollback and idempotent journal behavior. Snapshot values above are previews, not approved posting amounts.
