-- Treasury/day-close reconciliation: explain post-close movements without creating
-- any new accounting entries. The latest close always reconciles to the current
-- branch treasury balance; historical closes reconcile through the next close.

CREATE OR REPLACE FUNCTION public.get_branch_treasury_day_close_reconciliation(
  p_branch_id uuid,
  p_limit integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF NOT (
    public.can_permission('accounts.view')
    OR public.can_permission('reports.view')
    OR public.is_pos_admin()
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;

  WITH limited_closes AS (
    SELECT
      dc.id,
      dc.business_date,
      COALESCE(dc.closed_at, dc.created_at) AS closed_at,
      dc.report_snapshot
    FROM public.daily_closes dc
    WHERE dc.branch_id = p_branch_id
      AND dc.status = 'closed'
    ORDER BY COALESCE(dc.closed_at, dc.created_at) DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 365))
  ),
  closes AS (
    SELECT
      lc.*,
      lead(lc.closed_at) OVER (ORDER BY lc.closed_at) AS next_closed_at,
      row_number() OVER (ORDER BY lc.closed_at DESC) = 1 AS is_latest,
      COALESCE((
        SELECT sum((pm->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(lc.report_snapshot->'payment_methods', '[]'::jsonb)) pm
        WHERE lower(COALESCE(pm->>'method', '')) = 'cash'
      ), 0)::numeric AS cash_sales,
      COALESCE((
        SELECT sum((pm->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(lc.report_snapshot->'payment_methods', '[]'::jsonb)) pm
        WHERE lower(COALESCE(pm->>'method', '')) IN ('card', 'bank', 'transfer')
      ), 0)::numeric AS bank_sales,
      COALESCE((
        SELECT sum((pm->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(lc.report_snapshot->'payment_methods', '[]'::jsonb)) pm
        WHERE lower(COALESCE(pm->>'method', '')) = 'credit'
      ), 0)::numeric AS credit_sales,
      COALESCE(NULLIF(lc.report_snapshot->>'net_sales', '')::numeric, 0) AS net_sales,
      COALESCE(NULLIF(lc.report_snapshot->>'expenses', '')::numeric, 0) AS expenses,
      COALESCE(NULLIF(lc.report_snapshot->>'cash_purchases', '')::numeric, 0) AS cash_purchases
    FROM limited_closes lc
  ),
  account_balances AS (
    SELECT
      c.id AS close_id,
      t.account_type,
      sum(
        COALESCE(t.opening_balance, 0)
        + COALESCE((
          SELECT sum(l.debit - l.credit)
          FROM public.journal_entry_lines l
          JOIN public.journal_entries je ON je.id = l.journal_entry_id
          WHERE l.account_id = t.account_id
            AND je.created_at <= c.closed_at
        ), 0)
      ) AS balance_at_close,
      sum(
        COALESCE(t.opening_balance, 0)
        + COALESCE((
          SELECT sum(l.debit - l.credit)
          FROM public.journal_entry_lines l
          JOIN public.journal_entries je ON je.id = l.journal_entry_id
          WHERE l.account_id = t.account_id
            AND je.created_at <= COALESCE(c.next_closed_at, now())
        ), 0)
      ) AS balance_after_movement
    FROM closes c
    JOIN public.treasury_accounts t
      ON t.branch_id = p_branch_id
     AND t.is_active
     AND COALESCE(t.scope, 'branch') = 'branch'
    GROUP BY c.id, t.account_type
  ),
  rows AS (
    SELECT
      c.*,
      round(COALESCE(cash.balance_at_close, 0), 2) AS cash_balance_after_close,
      round(COALESCE(bank.balance_at_close, 0), 2) AS bank_balance_after_close,
      round(COALESCE(cash.balance_at_close, 0) + COALESCE(bank.balance_at_close, 0), 2) AS total_balance_after_close,
      round(COALESCE(cash.balance_after_movement, 0), 2) AS cash_balance_after_movement,
      round(COALESCE(bank.balance_after_movement, 0), 2) AS bank_balance_after_movement,
      round(COALESCE(cash.balance_after_movement, 0) + COALESCE(bank.balance_after_movement, 0), 2) AS total_balance_after_movement
    FROM closes c
    LEFT JOIN account_balances cash ON cash.close_id = c.id AND cash.account_type = 'cash'
    LEFT JOIN account_balances bank ON bank.close_id = c.id AND bank.account_type = 'bank'
  ),
  movement_details AS (
    SELECT
      c.id AS close_id,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'journal_entry_id', movement.journal_entry_id,
          'created_at', movement.created_at,
          'reference_type', movement.reference_type,
          'reference_id', movement.reference_id,
          'reference_number', movement.reference_number,
          'description', movement.description,
          'cash_effect', movement.cash_effect,
          'bank_effect', movement.bank_effect,
          'total_effect', movement.total_effect
        )
        ORDER BY movement.created_at, movement.journal_entry_id
      ), '[]'::jsonb) AS details
    FROM closes c
    LEFT JOIN LATERAL (
      SELECT
        je.id AS journal_entry_id,
        je.created_at,
        je.reference_type,
        je.reference_id,
        je.reference_number,
        je.description,
        round(sum(CASE WHEN ta.account_type = 'cash' THEN l.debit - l.credit ELSE 0 END), 2) AS cash_effect,
        round(sum(CASE WHEN ta.account_type = 'bank' THEN l.debit - l.credit ELSE 0 END), 2) AS bank_effect,
        round(sum(l.debit - l.credit), 2) AS total_effect
      FROM public.journal_entries je
      JOIN public.journal_entry_lines l ON l.journal_entry_id = je.id
      JOIN public.treasury_accounts ta
        ON ta.account_id = l.account_id
       AND ta.branch_id = p_branch_id
       AND ta.is_active
       AND COALESCE(ta.scope, 'branch') = 'branch'
      WHERE je.created_at > c.closed_at
        AND je.created_at <= COALESCE(c.next_closed_at, now())
      GROUP BY
        je.id,
        je.created_at,
        je.reference_type,
        je.reference_id,
        je.reference_number,
        je.description
      HAVING
        abs(sum(CASE WHEN ta.account_type = 'cash' THEN l.debit - l.credit ELSE 0 END))
        + abs(sum(CASE WHEN ta.account_type = 'bank' THEN l.debit - l.credit ELSE 0 END)) > 0.00001
    ) movement ON true
    GROUP BY c.id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'daily_close_id', r.id,
      'business_date', r.business_date,
      'closed_at', r.closed_at,
      'movement_until', COALESCE(r.next_closed_at, now()),
      'is_latest', r.is_latest,
      'cash_sales', round(r.cash_sales, 2),
      'bank_sales', round(r.bank_sales, 2),
      'credit_sales', round(r.credit_sales, 2),
      'net_sales', round(r.net_sales, 2),
      'expenses', round(r.expenses, 2),
      'cash_purchases', round(r.cash_purchases, 2),
      'cash_balance_after_close', r.cash_balance_after_close,
      'bank_balance_after_close', r.bank_balance_after_close,
      'total_balance_after_close', r.total_balance_after_close,
      'cash_movement_after_close', round(r.cash_balance_after_movement - r.cash_balance_after_close, 2),
      'bank_movement_after_close', round(r.bank_balance_after_movement - r.bank_balance_after_close, 2),
      'total_movement_after_close', round(r.total_balance_after_movement - r.total_balance_after_close, 2),
      'cash_balance_after_movement', r.cash_balance_after_movement,
      'bank_balance_after_movement', r.bank_balance_after_movement,
      'total_balance_after_movement', r.total_balance_after_movement,
      'movement_details', COALESCE(md.details, '[]'::jsonb)
    )
    ORDER BY r.closed_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM rows r
  LEFT JOIN movement_details md ON md.close_id = r.id;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'rows', COALESCE(v_result, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_branch_treasury_day_close_reconciliation(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_treasury_day_close_reconciliation(uuid, integer) TO authenticated;
