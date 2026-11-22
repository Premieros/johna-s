# Purchase correction GL reconciliation – 2026-11-22

## Incident and scope

A **read-only audit** in production found 23 superseded returned purchase revisions, but one of them did not have a corresponding `purchase_return` journal by branch and original invoice number. Do not repair by changing `purchases.returned_amount` alone: inventory and finance postings must remain auditable.

### Cleopatra: Johna's-00529

- Superseded record `35c9b134-573a-42c9-a0f4-69e3fa5a9ca9`, status returned, total **8,834.99 EGP**, header returned **0.00**, returned line amount **8,834.63**.
- Original purchase journal exists: debit raw inventory 8,834.63, debit purchase discount 0.36, credit accounts payable 8,834.99.
- Replacement purchase `1874a705-995e-4579-b072-4106283382af`: header total **7,997.96**, raw inventory debit **7,998.28**, purchase discount credit **0.32**, accounts payable credit **7,997.96**.
- Separately recorded **approved raw shortage variance**: debit stock variance 2,429.79, credit raw inventory 2,429.79. This is *not* a substitute for the purchase return ledger reversal.
- **No `purchase_return` journal found** by branch and original invoice number. The process_purchase_return function normally posts such a journal only when it detects an original purchase entry and a positive return amount.
- Do not assume a missing journal is the sole discrepancy: independently reconcile the referenced FIFO/raw inventory and supplier AP postings before creating an adjustment.

### Cleopatra: Johna's-00249

- Superseded record total 4,399.96, returned header and lines 4,400.06.
- Original purchase journal: debit raw inventory 4,400.06; credit cash 4,399.96; credit discount 0.10.
- Return journal: debit cash 4,400.06 and debit discount 0.10; credit inventory 4,400.16.
- Replacement purchase: debit raw inventory 4,400.06; credit AP 4,400.06.
- Journals each balance internally, but the financial mapping, cash, inventory and AP net effects must be approved by an accountant before compensating postings.

## Safe read-only reconciliation query

```sql
WITH rev AS (
 SELECT p.id,p.branch_id,p.invoice_number,p.total,p.returned_amount,
        regexp_replace(p.invoice_number,'-REV-[0-9a-fA-F]{8}$','') AS original_number
 FROM public.purchases p
 WHERE p.status='returned' AND p.invoice_number ~ '-REV-[0-9a-fA-F]{8}$'
)
SELECT r.original_number,r.branch_id,r.total,r.returned_amount,
       (SELECT COALESCE(sum(i.returned_amount),0)
        FROM public.purchase_items i WHERE i.purchase_id=r.id) AS returned_lines,
       (SELECT count(*) FROM public.journal_entries je WHERE je.branch_id=r.branch_id
          AND je.reference_type='purchase_return' AND je.reference_number=r.original_number)
          AS return_journals
FROM rev r
ORDER BY return_journals,r.original_number;
```

## Forward-only prevention

The accompanying guarded migration adds an atomic fail-closed check to `update_purchase_invoice`. When a positive purchase is corrected, a nonzero return amount and a **new matching purchase_return journal entry** are required before generating the corrected invoice. If not, an exception aborts the correction transaction, including its inventory operations. It does **not** backfill historical journals, mutate historical invoices, or disable FIFO checks.

Before historical repair, reconcile source invoice, supplier statement, stock movements, journal lines, financial period status, and approved shortage variance; use a separately reviewed, idempotent compensating entry rather than rewriting historical posted entries.

## Deployment

The source migration is not a historical data fix. GitHub Pages deploys only after all main-branch verification and production API parity pass. An unverified deployment must not be described as complete.
