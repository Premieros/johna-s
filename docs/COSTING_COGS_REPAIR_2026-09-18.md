# Costing COGS Repair — 2026-09-18

## Isolation

- Repository: `Premieros/johna-s`
- Base: `main@8ef8a90ba54c60b8204fc9e95774d2a86ab35be5`
- Branch: `development/costing-actual-cogs-kitchen-fix-20260918`
- Production database: **not modified**
- Other development branches / open PRs: **not modified**
- Printing, POS send flow, KDS, RLS policies and Windows agent: **not modified**

## Production diagnosis

The Costing Center card **Actual COGS / Net Sales** called
`get_costing_sales_summary`.

That RPC only counted `inventory_ledger` rows where:

- `entry_type = 'sale'`
- `reference_type = 'sale'`
- `reference_id = sales.id`

The current POS inventory boundary deducts stock earlier, at
`send_to_kitchen`. The authoritative rows are relabeled
`kitchen_send/kitchen_send` and their cost is persisted in
`order_kitchen_inventory_events`; payment later links each consumed event to
the resulting invoice through `settled_sale_id`.

Production read-only verification for **فرع نادي سموحة** showed the mismatch:
current settled kitchen sales existed while the old summary saw only the small
legacy `sale/sale` subset.

## Repair

Migration:
`supabase/migrations/20260918213000_costing_sales_summary_kitchen_cogs.sql`

The RPC signature and JSON response remain unchanged.

For each visible sale:

1. use settled `order_kitchen_inventory_events` COGS when present;
2. prorate an event only for any quantity voided before settlement;
3. otherwise fall back to the legacy `inventory_ledger sale/sale` COGS;
4. never add the two sources for the same sale.

Existing date, branch, status and net-sales semantics are intentionally kept
unchanged to make this a narrow repair.

Security is unchanged:

- `SECURITY INVOKER`
- `PUBLIC` revoked
- `anon` revoked
- execute granted to `authenticated`

## Regression coverage

Added:
`tests/integration/costing_sales_summary_kitchen_cogs.test.ts`

It verifies:

- current kitchen-event COGS is included;
- legacy COGS remains supported;
- an overlapping legacy row is not double counted;
- voided-before-settlement quantity is prorated;
- returned sales remain excluded;
- the RPC remains `SECURITY INVOKER`.

## Production gate

Do **not** run the new migration on Production until the isolated PR is green
and explicit Production approval is given.
