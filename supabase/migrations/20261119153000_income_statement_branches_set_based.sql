-- Set-based, branch-authorized income statement for dashboards at 100+ branches.
-- Computes the same account mappings and history limits as get_income_statement,
-- but scans journal entries once for all requested branches.
CREATE OR REPLACE FUNCTION public.get_income_statement_branches(
  p_branch_ids uuid[], p_from_date date, p_to_date date
) RETURNS TABLE(branch_id uuid, expenses numeric, net_income numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_permission('reports.financial') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  IF p_branch_ids IS NULL OR cardinality(p_branch_ids) > 500 THEN
    RAISE EXCEPTION 'INVALID_BRANCH_SCOPE' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_branch_ids) AS b(id)
    WHERE b.id IS NULL OR NOT public.user_may_access_branch(b.id)
  ) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH requested AS MATERIALIZED (
    SELECT DISTINCT id FROM unnest(p_branch_ids) AS b(id)
  ), bounds AS MATERIALIZED (
    SELECT public.history_clamp_from(p_from_date) AS date_from,
           public.history_clamp_to(p_to_date) AS date_to
  ), mappings AS MATERIALIZED (
    SELECT m.branch_id,
      (array_agg(m.account_id) FILTER (WHERE m.semantic_key = 'revenue'))[1] AS revenue_id,
      (array_agg(m.account_id) FILTER (WHERE m.semantic_key = 'other_income'))[1] AS other_income_id,
      (array_agg(m.account_id) FILTER (WHERE m.semantic_key = 'discount_given'))[1] AS discount_id,
      (array_agg(m.account_id) FILTER (WHERE m.semantic_key = 'cogs'))[1] AS cogs_id
    FROM public.account_mappings m
    JOIN requested r ON r.id = m.branch_id
    WHERE m.semantic_key IN ('revenue','other_income','discount_given','cogs')
    GROUP BY m.branch_id
  ), amounts AS (
    SELECT j.branch_id,
      sum(CASE WHEN l.account_id IN (m.revenue_id,m.other_income_id) THEN l.credit - l.debit ELSE 0 END) AS revenue,
      sum(CASE WHEN l.account_id = m.discount_id THEN l.debit - l.credit ELSE 0 END) AS discount,
      sum(CASE WHEN l.account_id = m.cogs_id THEN l.debit - l.credit ELSE 0 END) AS cogs,
      sum(CASE WHEN a.account_type = 'expense'
          AND l.account_id <> coalesce(m.cogs_id,'00000000-0000-0000-0000-000000000000'::uuid)
          THEN l.debit - l.credit ELSE 0 END) AS expenses
    FROM public.journal_entries j
    JOIN requested r ON r.id = j.branch_id
    CROSS JOIN bounds hb
    JOIN public.journal_entry_lines l ON l.journal_entry_id = j.id
    JOIN public.chart_of_accounts a ON a.id = l.account_id
    LEFT JOIN mappings m ON m.branch_id = j.branch_id
    WHERE j.entry_date >= hb.date_from AND j.entry_date <= hb.date_to
    GROUP BY j.branch_id
  )
  SELECT r.id,
    round(coalesce(x.expenses,0),2),
    round(coalesce(x.revenue,0) - coalesce(x.discount,0) - coalesce(x.cogs,0) - coalesce(x.expenses,0),2)
  FROM requested r LEFT JOIN amounts x ON x.branch_id = r.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_income_statement_branches(uuid[],date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_income_statement_branches(uuid[],date,date) TO authenticated,service_role;
