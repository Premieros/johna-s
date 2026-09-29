BEGIN;

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
  v_opening numeric := 0;
  v_opening_settled numeric := 0;
  v_opening_remaining numeric := 0;
  v_opening_date date;
  v_total_purchases numeric := 0;
  v_total_returns numeric := 0;
  v_purchase_paid numeric := 0;
  v_purchase_open numeric := 0;
  v_recorded_total numeric := 0;
  v_canonical_paid numeric := 0;
  v_canonical_open numeric := 0;
  v_reconciliation numeric := 0;
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

  SELECT
    COALESCE(ob.amount,0),
    COALESCE(ob.settled_amount,0),
    GREATEST(COALESCE(ob.amount,0)-COALESCE(ob.settled_amount,0),0),
    ob.opening_date
  INTO
    v_opening,
    v_opening_settled,
    v_opening_remaining,
    v_opening_date
  FROM public.supplier_opening_balances ob
  WHERE ob.supplier_id = p_supplier_id
    AND ob.branch_id = p_branch_id;

  SELECT
    COALESCE(sum(p.total),0),
    COALESCE(sum(COALESCE(p.returned_amount,0)),0),
    COALESCE(sum(COALESCE(p.paid_amount,0)),0),
    COALESCE(sum(GREATEST(
      COALESCE(p.total,0)
      - COALESCE(p.paid_amount,0)
      - COALESCE(p.returned_amount,0),
      0
    )),0)
  INTO
    v_total_purchases,
    v_total_returns,
    v_purchase_paid,
    v_purchase_open
  FROM public.purchases p
  WHERE p.supplier_id = p_supplier_id
    AND p.branch_id = p_branch_id
    AND p.status = 'completed';

  SELECT COALESCE(sum(sp.amount),0)
  INTO v_recorded_total
  FROM public.supplier_payments sp
  WHERE sp.supplier_id = p_supplier_id
    AND sp.branch_id = p_branch_id;

  v_canonical_paid := round(COALESCE(v_opening_settled,0) + COALESCE(v_purchase_paid,0), 2);
  v_canonical_open := round(COALESCE(v_opening_remaining,0) + COALESCE(v_purchase_open,0), 2);

  SELECT jsonb_build_object(
    'supplier_id', s.id,
    'supplier_name', s.name,
    'opening_balance', round(COALESCE(v_opening,0),2),
    'opening_remaining', round(COALESCE(v_opening_remaining,0),2),
    'total_purchases', round(COALESCE(v_total_purchases,0),2),
    'total_returns', round(COALESCE(v_total_returns,0),2),
    'total_paid', v_canonical_paid,
    'open_balance', v_canonical_open,
    'recorded_cash_payments', COALESCE(y.cash_paid,0),
    'recorded_card_payments', COALESCE(y.card_paid,0),
    'recorded_transfer_payments', COALESCE(y.transfer_paid,0),
    'recorded_other_payments', COALESCE(y.other_paid,0),
    'recorded_payments_total', round(COALESCE(v_recorded_total,0),2),
    'invoice_time_paid', GREATEST(v_canonical_paid-COALESCE(v_recorded_total,0),0),
    'payment_log_variance', round(COALESCE(v_recorded_total,0)-v_canonical_paid,2)
  )
  INTO v_summary
  FROM public.suppliers s
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method='cash'),0) cash_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method='card'),0) card_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method IN ('transfer','bank_transfer')),0) transfer_paid,
      COALESCE(sum(sp.amount) FILTER (
        WHERE sp.payment_method NOT IN ('cash','card','transfer','bank_transfer')
      ),0) other_paid
    FROM public.supplier_payments sp
    WHERE sp.supplier_id = s.id
      AND sp.branch_id = p_branch_id
  ) y ON true
  WHERE s.id = p_supplier_id
    AND s.branch_id = p_branch_id;

  WITH base_events AS (
    SELECT
      (v_opening_date::timestamp AT TIME ZONE 'Africa/Cairo') AS event_at,
      'opening_balance'::text AS entry_type,
      p_supplier_id AS source_id,
      NULL::text AS reference_number,
      COALESCE(v_opening,0)::numeric AS debit,
      0::numeric AS credit,
      'opening'::text AS payment_method,
      'Supplier opening balance'::text AS description
    WHERE COALESCE(v_opening,0) > 0

    UNION ALL

    SELECT
      p.created_at,
      'purchase'::text,
      p.id,
      p.invoice_number,
      GREATEST(COALESCE(p.total,0)-COALESCE(p.returned_amount,0),0)::numeric,
      0::numeric,
      p.payment_method::text,
      CASE
        WHEN COALESCE(p.returned_amount,0)>0 THEN 'Net purchase after returns'
        ELSE 'Purchase invoice'
      END::text
    FROM public.purchases p
    WHERE p.supplier_id = p_supplier_id
      AND p.branch_id = p_branch_id
      AND p.status = 'completed'

    UNION ALL

    SELECT
      sp.created_at,
      'payment'::text,
      sp.id,
      sp.reference_number,
      0::numeric,
      COALESCE(sp.amount,0)::numeric,
      sp.payment_method::text,
      COALESCE(NULLIF(sp.notes,''),'Supplier payment')::text
    FROM public.supplier_payments sp
    WHERE sp.supplier_id = p_supplier_id
      AND sp.branch_id = p_branch_id
  ),
  raw_totals AS (
    SELECT
      COALESCE(sum(debit-credit),0)::numeric AS raw_balance,
      COALESCE(max(event_at),now()) AS max_event_at
    FROM base_events
  ),
  reconciliation AS (
    SELECT
      rt.max_event_at + interval '1 microsecond' AS event_at,
      'balance_reconciliation'::text AS entry_type,
      p_supplier_id AS source_id,
      NULL::text AS reference_number,
      GREATEST(v_canonical_open-rt.raw_balance,0)::numeric AS debit,
      GREATEST(rt.raw_balance-v_canonical_open,0)::numeric AS credit,
      NULL::text AS payment_method,
      'Display reconciliation to canonical applied supplier balance'::text AS description
    FROM raw_totals rt
    WHERE abs(rt.raw_balance-v_canonical_open) > 0.009
  ),
  events AS (
    SELECT * FROM base_events
    UNION ALL
    SELECT * FROM reconciliation
  ),
  running AS (
    SELECT e.*,
      sum(e.debit-e.credit) OVER (
        ORDER BY e.event_at,e.entry_type,e.source_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance
    FROM events e
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event_at', r.event_at,
        'entry_type', r.entry_type,
        'source_id', r.source_id,
        'reference_number', r.reference_number,
        'debit', round(r.debit,2),
        'credit', round(r.credit,2),
        'payment_method', r.payment_method,
        'description', r.description,
        'running_balance', round(r.running_balance,2)
      )
      ORDER BY r.event_at DESC,r.entry_type DESC,r.source_id DESC
    ),
    '[]'::jsonb
  )
  INTO v_entries
  FROM running r;

  RETURN jsonb_build_object(
    'success', true,
    'summary', v_summary,
    'entries', v_entries
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_supplier_statement(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_statement(uuid,uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
