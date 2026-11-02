-- One bounded, branch-scoped read for the employee list's selected accounting period.
-- Reuse the canonical employee closing-balance function and the same customer
-- journal grain used by get_party_statement. No ledger or balance writes.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

CREATE FUNCTION public.get_employee_receivables_period_summary(
  p_branch_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_from date;
  v_to date;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR p_branch_id IS NULL
     OR NOT public.user_may_access_branch(p_branch_id)
     OR NOT public.can_permission('accounts.view') THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'EMPLOYEE_RECEIVABLE_PERIOD_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Match the same historical visibility boundary used by party statements.
  v_from := public.history_clamp_from(p_from_date);
  v_to := public.history_clamp_to(p_to_date);
  IF v_from IS NULL OR v_to IS NULL OR v_from > v_to THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH employee_balances AS MATERIALIZED (
    SELECT
      (b.value ->> 'customer_id')::uuid AS customer_id,
      COALESCE(b.value ->> 'name', '') AS employee_name,
      b.value ->> 'phone' AS phone,
      COALESCE((b.value ->> 'open_amount')::numeric, 0)::numeric(14,2) AS period_closing_balance
    FROM jsonb_array_elements(
      public.get_employee_receivable_balances(p_branch_id, v_to)
    ) AS b(value)
  ),
  period_movements AS MATERIALIZED (
    SELECT
      jl.customer_id,
      round(COALESCE(sum(jl.debit), 0), 2)::numeric(14,2) AS period_debit,
      round(COALESCE(sum(jl.credit), 0), 2)::numeric(14,2) AS period_credit
    FROM public.journal_entry_lines jl
    JOIN public.journal_entries j ON j.id = jl.journal_entry_id
    JOIN public.customers c
      ON c.id = jl.customer_id
     AND c.branch_id = p_branch_id
     AND c.customer_type = 'employee'
    WHERE j.branch_id = p_branch_id
      AND j.entry_date >= v_from
      AND j.entry_date <= v_to
    GROUP BY jl.customer_id
  ),
  result_rows AS (
    SELECT
      b.customer_id,
      b.employee_name,
      b.phone,
      round(
        b.period_closing_balance
        - COALESCE(m.period_debit, 0)
        + COALESCE(m.period_credit, 0),
        2
      )::numeric(14,2) AS period_opening_balance,
      COALESCE(m.period_debit, 0)::numeric(14,2) AS period_debit,
      COALESCE(m.period_credit, 0)::numeric(14,2) AS period_credit,
      b.period_closing_balance
    FROM employee_balances b
    LEFT JOIN period_movements m ON m.customer_id = b.customer_id
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(r) ORDER BY r.employee_name, r.customer_id),
    '[]'::jsonb
  )
  INTO v_rows
  FROM result_rows r;

  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_employee_receivables_period_summary(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_receivables_period_summary(uuid,date,date) TO authenticated;
COMMENT ON FUNCTION public.get_employee_receivables_period_summary(uuid,date,date)
  IS 'One branch-scoped employee receivables period projection using the canonical as-of employee balances and caller-visible customer journal movements. Read-only; applies history_clamp_from/to.';

COMMIT;
