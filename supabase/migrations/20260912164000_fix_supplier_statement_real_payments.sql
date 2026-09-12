-- Supplier statement payment integrity repair.
--
-- Historical purchase rows can contain paid_amount values that were written at
-- invoice creation time even though payment_method='credit'.  Those values are
-- not proof of a real supplier payment and must not reduce Accounts Payable.
--
-- Canonical rules after this migration:
--   * credit invoices contribute ZERO invoice-time payment;
--   * supplier_payments rows are the authoritative later-payment records;
--   * non-credit invoice-time payments remain supported, but any later recorded
--     supplier_payments linked to the invoice are subtracted first so they are
--     never counted twice;
--   * the statement balance is purchases - returns - real payments.
--
-- This changes reporting only. It does not mutate historical purchases,
-- supplier_payments, inventory, journal entries, or RLS policies.

CREATE OR REPLACE FUNCTION public.get_supplier_statement(
  p_supplier_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_summary jsonb;
  v_entries jsonb;
  v_invoice_time_paid numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF NOT public.can_permission('suppliers.view') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PERMISSION_DENIED',
      'permission', 'suppliers.view'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.suppliers s
    WHERE s.id = p_supplier_id
      AND s.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_FOUND');
  END IF;

  SELECT jsonb_build_object(
    'supplier_id', s.id,
    'supplier_name', s.name,
    'total_purchases', COALESCE(x.total_purchases, 0),
    'total_returns', COALESCE(x.total_returns, 0),
    'total_paid', COALESCE(x.invoice_time_paid, 0) + COALESCE(y.recorded_total, 0),
    'open_balance', GREATEST(
      COALESCE(x.total_purchases, 0)
        - COALESCE(x.total_returns, 0)
        - COALESCE(x.invoice_time_paid, 0)
        - COALESCE(y.recorded_total, 0),
      0
    ),
    'recorded_cash_payments', COALESCE(y.cash_paid, 0),
    'recorded_card_payments', COALESCE(y.card_paid, 0),
    'recorded_transfer_payments', COALESCE(y.transfer_paid, 0),
    'recorded_other_payments', COALESCE(y.other_paid, 0),
    'recorded_payments_total', COALESCE(y.recorded_total, 0),
    'invoice_time_paid', COALESCE(x.invoice_time_paid, 0)
  )
  INTO v_summary
  FROM public.suppliers s
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(p.total), 0) AS total_purchases,
      COALESCE(sum(p.returned_amount), 0) AS total_returns,
      COALESCE(sum(
        CASE
          -- A credit invoice is unpaid at creation by definition. Historical
          -- stale paid_amount values must not be presented as real payments.
          WHEN p.payment_method = 'credit' THEN 0
          ELSE GREATEST(
            COALESCE(p.paid_amount, 0) - COALESCE((
              SELECT sum(sp_linked.amount)
              FROM public.supplier_payments sp_linked
              WHERE sp_linked.purchase_id = p.id
                AND sp_linked.supplier_id = p.supplier_id
                AND sp_linked.branch_id = p.branch_id
            ), 0),
            0
          )
        END
      ), 0) AS invoice_time_paid
    FROM public.purchases p
    WHERE p.supplier_id = s.id
      AND p.branch_id = p_branch_id
      AND p.status = 'completed'
  ) x ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(sp.amount), 0) AS recorded_total,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method = 'cash'), 0) AS cash_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method = 'card'), 0) AS card_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method IN ('transfer', 'bank_transfer')), 0) AS transfer_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method NOT IN ('cash', 'card', 'transfer', 'bank_transfer')), 0) AS other_paid
    FROM public.supplier_payments sp
    WHERE sp.supplier_id = s.id
      AND sp.branch_id = p_branch_id
  ) y ON true
  WHERE s.id = p_supplier_id
    AND s.branch_id = p_branch_id;

  v_invoice_time_paid := COALESCE((v_summary->>'invoice_time_paid')::numeric, 0);

  WITH events AS (
    SELECT
      p.created_at AS event_at,
      'purchase'::text AS entry_type,
      p.id AS source_id,
      p.invoice_number AS reference_number,
      GREATEST(COALESCE(p.total, 0) - COALESCE(p.returned_amount, 0), 0)::numeric AS debit,
      0::numeric AS credit,
      p.payment_method::text AS payment_method,
      CASE
        WHEN COALESCE(p.returned_amount, 0) > 0 THEN 'Net purchase after returns'
        ELSE 'Purchase invoice'
      END::text AS description
    FROM public.purchases p
    WHERE p.supplier_id = p_supplier_id
      AND p.branch_id = p_branch_id
      AND p.status = 'completed'

    UNION ALL

    SELECT
      COALESCE((
        SELECT max(p.created_at)
        FROM public.purchases p
        WHERE p.supplier_id = p_supplier_id
          AND p.branch_id = p_branch_id
          AND p.status = 'completed'
      ), now()) + interval '1 microsecond',
      'invoice_time_payment'::text,
      p_supplier_id,
      NULL::text,
      0::numeric,
      v_invoice_time_paid,
      'invoice_time'::text,
      'Aggregate payments captured when non-credit purchase invoices were created'::text
    WHERE v_invoice_time_paid > 0

    UNION ALL

    SELECT
      sp.created_at,
      'payment'::text,
      sp.id,
      sp.reference_number,
      0::numeric,
      COALESCE(sp.amount, 0)::numeric,
      sp.payment_method::text,
      COALESCE(NULLIF(sp.notes, ''), 'Supplier payment')::text
    FROM public.supplier_payments sp
    WHERE sp.supplier_id = p_supplier_id
      AND sp.branch_id = p_branch_id
  ), running AS (
    SELECT
      e.*,
      sum(e.debit - e.credit) OVER (
        ORDER BY e.event_at, e.entry_type, e.source_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance
    FROM events e
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event_at', r.event_at,
    'entry_type', r.entry_type,
    'source_id', r.source_id,
    'reference_number', r.reference_number,
    'debit', round(r.debit, 2),
    'credit', round(r.credit, 2),
    'payment_method', r.payment_method,
    'description', r.description,
    'running_balance', round(r.running_balance, 2)
  ) ORDER BY r.event_at DESC, r.entry_type DESC, r.source_id DESC), '[]'::jsonb)
  INTO v_entries
  FROM running r;

  RETURN jsonb_build_object(
    'success', true,
    'summary', v_summary,
    'entries', v_entries
  );
END;
$function$;

-- Preserve the existing invocation surface: authenticated app users and the
-- service role may execute it; anon/public may not.
REVOKE ALL ON FUNCTION public.get_supplier_statement(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_supplier_statement(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_statement(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_statement(uuid, uuid) TO service_role;
