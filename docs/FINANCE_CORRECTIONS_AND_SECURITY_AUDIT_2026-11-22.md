# Johna's purchase correction and security review — 2026-11-22

## Financial discrepancies (read-only)

Do **not** delete corrected invoice audit copies or overwrite their header amounts. A corrected purchase creates a returned `-REV-xxxxxxxx` revision and a replacement invoice with the original number. The operational report excludes matching returned revisions, but their underlying journals remain available for audit.

Confirmed in production:
- `Johna's-00529-REV-35c9b134`: header total 8,834.99; header returned 0; summed line returns 8,834.63; replacement `Johna's-00529` total 7,997.96 with line total 7,998.28.
- `Johna's-00249-REV-f19adbd0`: header total 4,399.96; header returned 4,400.06; line returns 4,400.06; replacement total 4,400.06.
- All 23 matched correction revisions have fully returned line quantities. Two have header total/return differences; one has header/line-return mismatch. A header/line mismatch can reflect legitimate rounding/discount/tax, so investigate original vouchers and posting metadata before correction.

Run this diagnostic query as a read-only database operator. It never changes any ledger:
```sql
SELECT p.branch_id,p.id,p.invoice_number,p.status,p.total,p.returned_amount,
       SUM(i.total) AS line_total,SUM(COALESCE(i.returned_amount,0)) AS line_returned,
       BOOL_AND(COALESCE(i.returned_quantity,0)>=i.quantity) AS all_lines_returned,
       p.total-p.returned_amount AS header_net,
       p.returned_amount-SUM(COALESCE(i.returned_amount,0)) AS header_to_lines_delta
FROM public.purchases p
JOIN public.purchase_items i ON i.purchase_id=p.id
WHERE p.status='returned' AND p.invoice_number ~ '-REV-[0-9a-fA-F]{8}$'
GROUP BY p.id
HAVING ABS(p.total-p.returned_amount)>0.01
    OR ABS(p.returned_amount-SUM(COALESCE(i.returned_amount,0)))>0.01
ORDER BY p.invoice_number;
```

For each discrepancy, review the `purchase`, `purchase_return`, and approved shortage-variance journal entries alongside FIFO inventory movements, source invoice, and applied taxes/discounts. Changes to existing journal balances require a separately approved, auditable accounting adjustment with idempotency and replay tests; never fix the discrepancy by setting `returned_amount=total` alone.

## Authorization/backfill

The production-verified multi-branch RLS fix has been copied to canonical migrations. Avoid changing default branch or role; authorized branches are verified separately. The frontend now checks the actual active shift before editing/posting expenses. Closing a shift remains a server-side hard stop.

## Security and performance triage

Supabase advisors: 26 RLS-enabled no-policy tables, including private and internal deny-by-default tables (not automatically vulnerable); one anonymous SECURITY DEFINER status function exposing only a registration-enabled boolean (inspect intent before any revoke); 268 authenticated SECURITY DEFINER function warnings (audit effective grants and caller permission/branch checks individually); 17 RLS initplan performance notices; 101 multiple-permissive-policy notices; 150 unindexed FK notices. Enable leaked-password protection through Auth settings after reviewing sign-in compatibility. Prioritize index changes only after `EXPLAIN (ANALYZE, BUFFERS)` evidence; do not blindly add 150 indexes.

References:
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
