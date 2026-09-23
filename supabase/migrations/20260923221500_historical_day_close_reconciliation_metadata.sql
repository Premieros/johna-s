BEGIN;

-- Preserve immutable historical day-close snapshots while making any display-time
-- reconciliation explicit to the operator. New closes should naturally match and
-- therefore report historical_reconciled=false.
CREATE OR REPLACE FUNCTION private.normalize_day_close_cash(
  p_report jsonb,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_start timestamptz := NULLIF(p_report->>'window_start','')::timestamptz;
  v_end timestamptz := NULLIF(p_report->>'window_end','')::timestamptz;
  v_cash_expenses numeric := 0;
  v_cash_sales numeric := COALESCE(NULLIF(p_report->>'cash_sales','')::numeric,0);
  v_cash_purchases numeric := COALESCE(NULLIF(p_report->>'cash_purchases','')::numeric,0);
  v_snapshot_cash_expenses numeric := COALESCE(NULLIF(p_report->>'cash_expenses','')::numeric,0);
  v_snapshot_cash_after numeric := COALESCE(NULLIF(p_report->>'cash_after_outflows','')::numeric,0);
  v_normalized_cash_after numeric := 0;
  v_reconciled boolean := false;
BEGIN
  IF p_report IS NULL OR p_report='{}'::jsonb OR v_start IS NULL OR v_end IS NULL THEN
    RETURN COALESCE(p_report,'{}'::jsonb);
  END IF;

  SELECT COALESCE(round(sum(e.amount),2),0)
  INTO v_cash_expenses
  FROM public.expenses e
  WHERE e.branch_id=p_branch_id
    AND e.status='posted'
    AND e.created_at>=v_start
    AND e.created_at<=v_end
    AND private.treasury_affects_shift_cash(e.treasury_account_id,e.branch_id);

  v_normalized_cash_after := round(v_cash_sales-v_cash_expenses-v_cash_purchases,2);
  v_reconciled :=
    round(v_snapshot_cash_expenses,2) <> round(v_cash_expenses,2)
    OR round(v_snapshot_cash_after,2) <> v_normalized_cash_after;

  RETURN p_report || jsonb_build_object(
    'cash_expenses',round(v_cash_expenses,2),
    'cash_after_outflows',v_normalized_cash_after,
    'cash_source_rule','branch_cash_only',
    'historical_reconciled',v_reconciled,
    'snapshot_cash_expenses',round(v_snapshot_cash_expenses,2),
    'snapshot_cash_after_outflows',round(v_snapshot_cash_after,2),
    'reconciliation_cash_expense_delta',round(v_cash_expenses-v_snapshot_cash_expenses,2),
    'reconciliation_cash_after_delta',round(v_normalized_cash_after-v_snapshot_cash_after,2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.normalize_day_close_cash(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.normalize_day_close_cash(jsonb,uuid) TO service_role,postgres;

COMMIT;
