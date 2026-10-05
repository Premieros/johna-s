-- Additive read-only API. Do not replace get_journals or any posting function.
-- Production apply requires separate explicit approval (see active work log).
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

CREATE FUNCTION public.get_journals_page(
  p_branch_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page_size integer DEFAULT 100,
  p_after_entry_date date DEFAULT NULL,
  p_after_entry_number text DEFAULT NULL,
  p_after_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 200 THEN
    RAISE EXCEPTION 'JOURNAL_PAGE_SIZE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF num_nonnulls(p_after_entry_date, p_after_entry_number, p_after_id) NOT IN (0, 3) THEN
    RAISE EXCEPTION 'JOURNAL_CURSOR_INCOMPLETE' USING ERRCODE = '22023';
  END IF;

  -- Every table read retains caller RLS, including restrictive Financial Visibility.
  -- Summary has no cursor predicate: it covers the complete authorized filter range.
  WITH bounds AS MATERIALIZED (
    SELECT public.history_clamp_from(p_from_date) AS from_date,
           public.history_clamp_to(p_to_date) AS to_date
  ), filtered AS MATERIALIZED (
    SELECT j.id, j.entry_number, j.entry_date, j.reference_type, j.reference_id,
           j.reference_number, j.description, j.created_at
    FROM public.journal_entries j CROSS JOIN bounds b
    WHERE j.branch_id = p_branch_id
      AND (b.from_date IS NULL OR j.entry_date >= b.from_date)
      AND (b.to_date IS NULL OR j.entry_date <= b.to_date)
      AND (p_reference_type IS NULL OR j.reference_type = p_reference_type)
      AND (p_search IS NULL OR j.entry_number ILIKE '%' || p_search || '%'
                              OR j.reference_number ILIKE '%' || p_search || '%')
  ), entry_totals AS MATERIALIZED (
    SELECT f.id, round(COALESCE(sum(l.debit), 0), 2) AS debit_total,
                 round(COALESCE(sum(l.credit), 0), 2) AS credit_total
    FROM filtered f
    LEFT JOIN public.journal_entry_lines l ON l.journal_entry_id = f.id
    GROUP BY f.id
  ), candidates AS MATERIALIZED (
    SELECT f.* FROM filtered f
    WHERE p_after_id IS NULL
       OR (f.entry_date, f.entry_number, f.id)
          > (p_after_entry_date, p_after_entry_number, p_after_id)
    ORDER BY f.entry_date, f.entry_number, f.id
    LIMIT p_page_size + 1
  ), page AS MATERIALIZED (
    SELECT c.* FROM candidates c
    ORDER BY c.entry_date, c.entry_number, c.id
    LIMIT p_page_size
  ), rows AS (
    SELECT p.*, t.debit_total, t.credit_total,
           (SELECT COALESCE(jsonb_agg(line ORDER BY line.id), '[]'::jsonb)
            FROM (
              SELECT l.id, a.code, a.name AS account_name, a.account_type,
                     round(l.debit, 2) AS debit, round(l.credit, 2) AS credit,
                     l.note, l.customer_id, l.supplier_id
              FROM public.journal_entry_lines l
              JOIN public.chart_of_accounts a ON a.id = l.account_id
              WHERE l.journal_entry_id = p.id
            ) line) AS lines
    FROM page p JOIN entry_totals t ON t.id = p.id
  ), summary AS (
    SELECT count(*) AS total_count,
           COALESCE(sum(debit_total), 0) AS debit_total,
           COALESCE(sum(credit_total), 0) AS credit_total,
           COALESCE(sum(debit_total - credit_total), 0) AS balance
    FROM entry_totals
  )
  SELECT jsonb_build_object(
    'rows', (SELECT COALESCE(jsonb_agg(r ORDER BY r.entry_date, r.entry_number, r.id), '[]'::jsonb) FROM rows r),
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'page_size', p_page_size,
    'has_more', (SELECT count(*) > p_page_size FROM candidates),
    'next_cursor', CASE WHEN (SELECT count(*) > p_page_size FROM candidates) THEN
      (SELECT jsonb_build_object('entry_date', p.entry_date, 'entry_number', p.entry_number, 'id', p.id)
       FROM page p ORDER BY p.entry_date DESC, p.entry_number DESC, p.id DESC LIMIT 1)
      ELSE NULL END
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_journals_page(uuid,date,date,text,text,integer,date,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_journals_page(uuid,date,date,text,text,integer,date,text,uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_journals_page(uuid,date,date,text,text,integer,date,text,uuid)
  IS 'Bounded journal detail page and complete caller-visible filter totals; invoker RLS and history guards preserved.';
