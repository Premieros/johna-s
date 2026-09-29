BEGIN;

-- Enrich the single-source cash reconciliation with exact real movements that were NOT already included in any closed shift.
-- This prevents purchases/expenses/sales already deducted in shift net from being presented or deducted twice.

-- One cash truth for employee handover and treasury daily reconciliation.
-- Cash carried + daily cash net must always equal actual cash closing balance.
-- Shift cash net is recalculated from the canonical shift calculator so stale
-- historical shifts do not misstate what the employee should have handed over.

CREATE OR REPLACE FUNCTION public.get_branch_treasury_day_close_reconciliation(
  p_branch_id uuid,
  p_limit integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_start_date date;
  v_end_date date := (now() AT TIME ZONE 'Africa/Cairo')::date;
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

  SELECT min((s.created_at AT TIME ZONE 'Africa/Cairo')::date)
  INTO v_start_date
  FROM public.sales s
  WHERE s.branch_id = p_branch_id
    AND (
      s.invoice_number LIKE 'HIST-%'
      OR s.invoice_number LIKE 'IMP-%HIST%'
      OR COALESCE(s.notes, '') ILIKE '%ترحيل تاريخ%'
      OR COALESCE(s.notes, '') LIKE '%"import"%'
    );

  IF v_start_date IS NULL THEN
    SELECT min(dc.business_date)
    INTO v_start_date
    FROM public.daily_closes dc
    WHERE dc.branch_id = p_branch_id
      AND dc.status = 'closed';
  END IF;

  IF v_start_date IS NULL THEN
    SELECT min(COALESCE(je.entry_date, (je.created_at AT TIME ZONE 'Africa/Cairo')::date))
    INTO v_start_date
    FROM public.journal_entries je
    JOIN public.journal_entry_lines l ON l.journal_entry_id = je.id
    JOIN public.treasury_accounts ta
      ON ta.account_id = l.account_id
     AND ta.branch_id = p_branch_id
     AND ta.is_active
     AND COALESCE(ta.scope, 'branch') = 'branch';
  END IF;

  v_start_date := COALESCE(v_start_date, v_end_date);

  WITH RECURSIVE
  account_opening AS (
    SELECT
      COALESCE(sum(CASE WHEN ta.account_type = 'cash' THEN ta.opening_balance ELSE 0 END), 0)::numeric AS cash_opening,
      COALESCE(sum(CASE WHEN ta.account_type = 'bank' THEN ta.opening_balance ELSE 0 END), 0)::numeric AS bank_opening
    FROM public.treasury_accounts ta
    WHERE ta.branch_id = p_branch_id
      AND ta.is_active
      AND COALESCE(ta.scope, 'branch') = 'branch'
  ),
  activity_base AS (
    SELECT
      je.id AS journal_entry_id,
      je.reference_type,
      je.reference_id,
      je.reference_number,
      je.description,
      je.created_at,
      ta.account_type,
      (l.debit - l.credit)::numeric AS effect,
      COALESCE(
        CASE
          WHEN je.reference_type = 'sale'
            THEN (s.created_at AT TIME ZONE 'Africa/Cairo')::date
          WHEN je.reference_type IN ('purchase', 'purchase_return')
            THEN (p.created_at AT TIME ZONE 'Africa/Cairo')::date
          WHEN je.reference_type = 'expense'
            THEN COALESCE(e.expense_date, je.entry_date)
          ELSE je.entry_date
        END,
        (je.created_at AT TIME ZONE 'Africa/Cairo')::date
      ) AS resolved_date
    FROM public.journal_entries je
    JOIN public.journal_entry_lines l ON l.journal_entry_id = je.id
    JOIN public.treasury_accounts ta
      ON ta.account_id = l.account_id
     AND ta.branch_id = p_branch_id
     AND ta.is_active
     AND COALESCE(ta.scope, 'branch') = 'branch'
    LEFT JOIN public.sales s
      ON je.reference_type = 'sale'
     AND s.id = je.reference_id
    LEFT JOIN public.purchases p
      ON je.reference_type IN ('purchase', 'purchase_return')
     AND p.id = je.reference_id
    LEFT JOIN public.expenses e
      ON je.reference_type = 'expense'
     AND e.id = je.reference_id
    WHERE je.branch_id = p_branch_id
  ),
  activity AS (
    SELECT
      ab.*,
      GREATEST(ab.resolved_date, v_start_date) AS activity_date
    FROM activity_base ab
  ),
  journal_movements AS (
    SELECT
      a.activity_date,
      a.journal_entry_id,
      min(a.created_at) AS created_at,
      min(a.reference_type) AS reference_type,
      min(a.reference_id::text)::uuid AS reference_id,
      min(a.reference_number) AS reference_number,
      min(a.description) AS description,
      round(sum(CASE WHEN a.account_type = 'cash' THEN a.effect ELSE 0 END), 2) AS cash_effect,
      round(sum(CASE WHEN a.account_type = 'bank' THEN a.effect ELSE 0 END), 2) AS bank_effect,
      round(sum(a.effect), 2) AS total_effect
    FROM activity a
    GROUP BY a.activity_date, a.journal_entry_id
    HAVING abs(sum(a.effect)) > 0.00001
        OR abs(sum(CASE WHEN a.account_type = 'cash' THEN a.effect ELSE 0 END)) > 0.00001
        OR abs(sum(CASE WHEN a.account_type = 'bank' THEN a.effect ELSE 0 END)) > 0.00001
  ),
  classified_movements AS (
    SELECT
      jm.*,
      CASE
        WHEN jm.reference_type = 'sale' THEN EXISTS (
          SELECT 1
          FROM public.shift_operations op
          JOIN public.shifts sh ON sh.id = op.shift_id
          WHERE sh.branch_id = p_branch_id
            AND sh.status = 'closed'
            AND op.reference_type = 'sale'
            AND op.reference_id = jm.reference_id
        )
        WHEN jm.reference_type = 'expense' THEN EXISTS (
          SELECT 1
          FROM public.expenses e
          JOIN public.shifts sh ON sh.id = e.shift_id
          WHERE e.id = jm.reference_id
            AND e.status = 'posted'
            AND sh.branch_id = p_branch_id
            AND sh.status = 'closed'
        )
        WHEN jm.reference_type IN ('purchase', 'purchase_return') THEN EXISTS (
          SELECT 1
          FROM public.purchases p
          JOIN public.shifts sh
            ON sh.branch_id = p_branch_id
           AND sh.status = 'closed'
           AND p.created_at >= sh.opened_at
           AND p.created_at <= COALESCE(sh.closed_at, now())
          WHERE p.id = jm.reference_id
            AND p.branch_id = p_branch_id
        )
        ELSE false
      END AS included_in_shift
    FROM journal_movements jm
  ),
  daily_effects AS (
    SELECT
      jm.activity_date,
      COALESCE(sum(jm.cash_effect), 0)::numeric AS cash_effect,
      COALESCE(sum(jm.bank_effect), 0)::numeric AS bank_effect,
      COALESCE(sum(jm.total_effect), 0)::numeric AS total_effect,
      COALESCE(sum(jm.cash_effect) FILTER (WHERE jm.reference_type = 'sale'), 0)::numeric AS cash_sales,
      COALESCE(sum(jm.bank_effect) FILTER (WHERE jm.reference_type = 'sale'), 0)::numeric AS bank_sales,
      GREATEST(
        -COALESCE(sum(jm.total_effect) FILTER (WHERE jm.reference_type = 'expense'), 0),
        0
      )::numeric AS expenses,
      GREATEST(
        -COALESCE(sum(jm.total_effect) FILTER (WHERE jm.reference_type IN ('purchase', 'purchase_return')), 0),
        0
      )::numeric AS cash_purchases
    FROM journal_movements jm
    GROUP BY jm.activity_date
  ),
  shift_daily AS (
    SELECT
      GREATEST((sh.opened_at AT TIME ZONE 'Africa/Cairo')::date, v_start_date) AS activity_date,
      round(COALESCE(sum(public._compute_shift_expected_cash(sh.id)), 0), 2)::numeric AS shift_cash_net
    FROM public.shifts sh
    WHERE sh.branch_id = p_branch_id
      AND sh.status = 'closed'
    GROUP BY GREATEST((sh.opened_at AT TIME ZONE 'Africa/Cairo')::date, v_start_date)
  ),
  sales_daily AS (
    SELECT
      GREATEST((s.created_at AT TIME ZONE 'Africa/Cairo')::date, v_start_date) AS activity_date,
      COALESCE(sum(s.total - COALESCE(s.refunded_amount, 0)), 0)::numeric AS net_sales,
      COALESCE(sum(GREATEST(s.total - s.paid_amount, 0)), 0)::numeric AS credit_sales
    FROM public.sales s
    WHERE s.branch_id = p_branch_id
      AND s.status <> 'cancelled'
    GROUP BY GREATEST((s.created_at AT TIME ZONE 'Africa/Cairo')::date, v_start_date)
  ),
  close_by_date AS (
    SELECT DISTINCT ON (dc.business_date)
      dc.business_date,
      dc.id AS daily_close_id,
      COALESCE(dc.closed_at, dc.created_at) AS closed_at
    FROM public.daily_closes dc
    WHERE dc.branch_id = p_branch_id
      AND dc.status = 'closed'
      AND dc.business_date >= v_start_date
    ORDER BY dc.business_date, COALESCE(dc.closed_at, dc.created_at) DESC, dc.id DESC
  ),
  calendar AS (
    SELECT gs::date AS business_date
    FROM generate_series(v_start_date, v_end_date, interval '1 day') gs
  ),
  daily AS (
    SELECT
      c.business_date,
      cbd.daily_close_id,
      COALESCE(
        cbd.closed_at,
        ((c.business_date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
      ) AS closed_at,
      COALESCE(de.cash_effect, 0)::numeric AS cash_effect,
      COALESCE(de.bank_effect, 0)::numeric AS bank_effect,
      COALESCE(de.total_effect, 0)::numeric AS total_effect,
      COALESCE(de.cash_sales, 0)::numeric AS cash_sales,
      COALESCE(de.bank_sales, 0)::numeric AS bank_sales,
      COALESCE(sld.credit_sales, 0)::numeric AS credit_sales,
      COALESCE(sld.net_sales, 0)::numeric AS net_sales,
      COALESCE(de.expenses, 0)::numeric AS expenses,
      COALESCE(de.cash_purchases, 0)::numeric AS cash_purchases,
      COALESCE(shd.shift_cash_net, 0)::numeric AS shift_cash_net
    FROM calendar c
    LEFT JOIN daily_effects de ON de.activity_date = c.business_date
    LEFT JOIN shift_daily shd ON shd.activity_date = c.business_date
    LEFT JOIN sales_daily sld ON sld.activity_date = c.business_date
    LEFT JOIN close_by_date cbd ON cbd.business_date = c.business_date
  ),
  sequenced AS (
    SELECT
      d.*,
      ao.cash_opening
        + COALESCE(sum(d.cash_effect) OVER (
            ORDER BY d.business_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS cash_opening_balance,
      ao.bank_opening
        + COALESCE(sum(d.bank_effect) OVER (
            ORDER BY d.business_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS bank_opening_balance,
      ao.cash_opening
        + sum(d.cash_effect) OVER (
            ORDER BY d.business_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS cash_closing_balance,
      ao.bank_opening
        + sum(d.bank_effect) OVER (
            ORDER BY d.business_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS bank_closing_balance
    FROM daily d
    CROSS JOIN account_opening ao
  ),
  movement_details AS (
    SELECT
      cm.activity_date,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'journal_entry_id', cm.journal_entry_id,
            'created_at', cm.created_at,
            'reference_type', cm.reference_type,
            'reference_id', cm.reference_id,
            'reference_number', cm.reference_number,
            'description', cm.description,
            'cash_effect', cm.cash_effect,
            'bank_effect', cm.bank_effect,
            'total_effect', cm.total_effect,
            'included_in_shift', cm.included_in_shift
          )
          ORDER BY cm.created_at, cm.journal_entry_id
        ),
        '[]'::jsonb
      ) AS details,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'journal_entry_id', cm.journal_entry_id,
            'created_at', cm.created_at,
            'reference_type', cm.reference_type,
            'reference_id', cm.reference_id,
            'reference_number', cm.reference_number,
            'description', cm.description,
            'cash_effect', cm.cash_effect,
            'bank_effect', cm.bank_effect,
            'total_effect', cm.total_effect,
            'included_in_shift', false
          )
          ORDER BY cm.created_at, cm.journal_entry_id
        ) FILTER (
          WHERE NOT cm.included_in_shift
            AND abs(cm.cash_effect) > 0.00001
        ),
        '[]'::jsonb
      ) AS outside_shift_details
    FROM classified_movements cm
    GROUP BY cm.activity_date
  ),
  limited AS (
    SELECT s.*
    FROM sequenced s
    ORDER BY s.business_date DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 365))
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'daily_close_id', l.daily_close_id,
        'business_date', l.business_date,
        'closed_at', l.closed_at,
        'movement_until', l.closed_at,
        'is_latest', l.business_date = v_end_date,
        'cash_sales', round(l.cash_sales, 2),
        'bank_sales', round(l.bank_sales, 2),
        'credit_sales', round(l.credit_sales, 2),
        'net_sales', round(l.net_sales, 2),
        'expenses', round(l.expenses, 2),
        'cash_purchases', round(l.cash_purchases, 2),
        'transfer_in', round(COALESCE((
          SELECT sum(tx.amount)
          FROM public.treasury_transactions tx
          JOIN public.treasury_accounts fa ON fa.id = tx.from_account_id
          JOIN public.treasury_accounts ta ON ta.id = tx.to_account_id
          WHERE tx.transaction_type = 'transfer'
            AND (tx.created_at AT TIME ZONE 'Africa/Cairo')::date = l.business_date
            AND ta.scope = 'branch'
            AND ta.branch_id = p_branch_id
            AND (fa.scope = 'organization' OR fa.branch_id IS DISTINCT FROM p_branch_id)
        ), 0), 2),
        'transfer_out', round(COALESCE((
          SELECT sum(tx.amount)
          FROM public.treasury_transactions tx
          JOIN public.treasury_accounts fa ON fa.id = tx.from_account_id
          JOIN public.treasury_accounts ta ON ta.id = tx.to_account_id
          WHERE tx.transaction_type = 'transfer'
            AND (tx.created_at AT TIME ZONE 'Africa/Cairo')::date = l.business_date
            AND fa.scope = 'branch'
            AND fa.branch_id = p_branch_id
            AND (ta.scope = 'organization' OR ta.branch_id IS DISTINCT FROM p_branch_id)
        ), 0), 2),
        'shift_cash_net', round(l.shift_cash_net, 2),
        'cash_day_net', round(l.cash_effect, 2),
        'cash_outside_shifts', round(l.cash_effect - l.shift_cash_net, 2),
        'opening_balance', round(l.cash_opening_balance + l.bank_opening_balance, 2),
        'cash_opening_balance', round(l.cash_opening_balance, 2),
        'bank_opening_balance', round(l.bank_opening_balance, 2),
        'day_net', round(l.total_effect, 2),
        'closing_balance', round(l.cash_closing_balance + l.bank_closing_balance, 2),
        'cash_balance_after_close', round(l.cash_closing_balance, 2),
        'bank_balance_after_close', round(l.bank_closing_balance, 2),
        'total_balance_after_close', round(l.cash_closing_balance + l.bank_closing_balance, 2),
        'cash_movement_after_close', 0,
        'bank_movement_after_close', 0,
        'total_movement_after_close', 0,
        'cash_balance_after_movement', round(l.cash_closing_balance, 2),
        'bank_balance_after_movement', round(l.bank_closing_balance, 2),
        'total_balance_after_movement', round(l.cash_closing_balance + l.bank_closing_balance, 2),
        'movement_details', COALESCE(md.details, '[]'::jsonb),
        'outside_shift_details', COALESCE(md.outside_shift_details, '[]'::jsonb)
      )
      ORDER BY l.business_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM limited l
  LEFT JOIN movement_details md ON md.activity_date = l.business_date;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'start_date', v_start_date,
    'end_date', v_end_date,
    'rows', COALESCE(v_result, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_branch_treasury_day_close_reconciliation(uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_treasury_day_close_reconciliation(uuid, integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
