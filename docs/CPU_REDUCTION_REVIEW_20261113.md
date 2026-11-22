# Johna's database CPU review, 2026-11-13

Status: approved by the user and applied to Johna's production at 2026-11-13
13:17:37 UTC (15:17:37 Cairo). Migration 20261113131737_product_read_permission_initplans.
Only auth_select_products changed. Credentials, sessions, publication, write
policies and business rows were not changed.

## Evidence

Statistics reset: 2026-11-12 18:31:00 UTC. Accumulated execution time is not CPU time.
Realtime list_changes: 132,068 calls, 1,037,997.7 ms accumulated execution.
Open orders with nested children: 1,872 calls, 109.54 ms average.
Dining-table reads: 1,884 calls, 44.24 ms average.
Product reads: 205 calls, 330.72 ms average.
The short subsequent sample added 44 Realtime calls and 235.6 ms execution;
the listed business reads did not increase during that sample.
No blocked/running business query was present in the activity snapshot.
Health advisor returned no findings. This does not establish host CPU utilization.
Do not terminate Realtime, print workers, idle pools or business-day closing jobs.

## Limited candidate

Cache the existing is_platform_admin(), can_permission('products.view') and
can_permission('pos.view') results once per statement using scalar SELECTs.
Keep user_may_access_branch(branch_id), active-product condition, all write
policies, grants and policy roles unchanged. Official guidance:
https://supabase.com/docs/guides/database/postgres/row-level-security

Source policy predicate digest: e96c22e7c7f6095be27a0f83f2f22115.
The applied migration refuses source drift and busy-table locks without waiting.
The rollback also rejects intervening policy drift.

## Validation actually performed

Read-only, rollback-ended production transactions compared the original and
candidate expressions over all 518 existing products, for one existing active
user in each role: cashier, branch_manager, super_admin, kitchen, accountant.
2,590 comparisons: zero mismatches. Identities were not written into this report.

One paired EXPLAIN ANALYZE, with cashier JWT context and direct expression
evaluation (not an installed RLS policy), returned the same 257 visible products:

| Expression | Execution ms | Shared-buffer hits | Physical blocks read |
| --- | ---: | ---: | ---: |
| Original | 222.981 | 4,788 | 0 |
| Candidate | 111.454 | 2,203 | 0 |

Candidate plan contains three InitPlans, each executed once. Single samples are
not a representative latency distribution or a host CPU-reduction estimate.
Concurrent permission changes and end-to-end POS flows have not been tested
with this candidate installed in production.

An isolated PostgreSQL fixture (@electric-sql/pglite 0.5.16, installed outside
the repository) passed scripts/ci/check-product-read-initplans.mjs. The actual
forward and rollback SQL ran against RLS-enabled fixture tables. Eight identities
were checked before installation, afterward and after rollback: administrator,
POS-only cashier with an extra branch grant, product viewer, unprivileged user,
inactive user, inactive role, absent JWT subject and nonexistent user. Checks
cover active/inactive products and null/foreign branches; write policies and
policy roles remain identical. Actual RLS EXPLAIN has three InitPlans, each at
most one execution. Rollback restores the exact source policy digest. Source
drift is rejected. This is not a full Supabase-stack integration rehearsal;
busy-lock behavior and installed Windows clients were not exercised.

## Production verification

The installed SELECT policy digest is 526770ea209aa0d85ff45bac32efbe7a.
INSERT/UPDATE/DELETE predicate digests, policy roles and permissiveness matched
their captured pre-application values. Real authenticated RLS reads returned
identical product ID sets to the original expression for cashier (257), branch
manager (256), super admin (518), kitchen (518) and accountant (262).
A post-application real RLS count under the cashier identity took 77.635 ms,
with 2,206 shared-buffer hits and zero physical blocks read; all three InitPlans
executed once. This is one additional sample, not a host CPU measurement.
The health advisor returned no findings. Security advisor warnings about
function execute privileges/password protection and policy-less RLS tables are
outside this SELECT-only change; no grants or functions were modified.

The CLI generated a migration file locally; its timestamp was aligned to the
actual applied migration version returned by supabase_migrations.schema_migrations.

## Scope boundary

User approval covered this one product SELECT optimization. No other production
optimization was applied. The source reconciliation PR records an already
applied database change; it does not need a frontend deployment. No source merge
has been performed by this investigation.
