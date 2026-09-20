BEGIN;

-- Canonical historical-read guard. No existing role is auto-granted
-- history.unlimited. Super Admin remains the only implicit bypass.
CREATE OR REPLACE FUNCTION public.history_business_date()
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT (now() AT TIME ZONE 'Africa/Cairo')::date;
$$;

CREATE OR REPLACE FUNCTION public.history_min_date()
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.can_permission('history.unlimited') THEN NULL::date
    ELSE public.history_business_date() - 6
  END;
$$;

CREATE OR REPLACE FUNCTION public.history_clamp_from(p_from date)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.history_min_date() IS NULL THEN p_from
    ELSE GREATEST(COALESCE(p_from, public.history_min_date()), public.history_min_date())
  END;
$$;

CREATE OR REPLACE FUNCTION public.history_clamp_to(p_to date)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.history_min_date() IS NULL THEN p_to
    ELSE GREATEST(COALESCE(p_to, public.history_business_date()), public.history_min_date())
  END;
$$;

CREATE OR REPLACE FUNCTION public.history_clamp_as_of(p_as_of date)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.history_min_date() IS NULL THEN COALESCE(p_as_of, public.history_business_date())
    ELSE GREATEST(COALESCE(p_as_of, public.history_business_date()), public.history_min_date())
  END;
$$;

CREATE OR REPLACE FUNCTION public.history_date_start(p_date date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT (p_date::timestamp AT TIME ZONE 'Africa/Cairo');
$$;

CREATE OR REPLACE FUNCTION public.history_min_instant()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.history_min_date() IS NULL THEN NULL::timestamptz
    ELSE public.history_date_start(public.history_min_date())
  END;
$$;

REVOKE ALL ON FUNCTION public.history_business_date() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_min_date() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_clamp_from(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_clamp_to(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_clamp_as_of(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_date_start(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_min_instant() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.history_business_date() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_min_date() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_clamp_from(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_clamp_to(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_clamp_as_of(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_date_start(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_min_instant() TO authenticated, service_role;

-- Harden get_journals
CREATE OR REPLACE FUNCTION public.get_journals(p_branch_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_reference_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT COALESCE(jsonb_agg(e ORDER BY e.entry_date, e.entry_number), '[]'::jsonb)
FROM (
  SELECT j.id, j.entry_number, j.entry_date, j.reference_type, j.reference_id,
         j.reference_number, j.description, j.created_at,
         round(COALESCE(SUM(l.debit), 0), 2) AS debit_total,
         round(COALESCE(SUM(l.credit), 0), 2) AS credit_total,
         (SELECT COALESCE(jsonb_agg(line ORDER BY line.id), '[]'::jsonb)
          FROM (
            SELECT l.id, a.code, a.name AS account_name, a.account_type,
                   round(l.debit, 2) AS debit, round(l.credit, 2) AS credit,
                   l.note, l.customer_id, l.supplier_id
            FROM public.journal_entry_lines l
            JOIN public.chart_of_accounts a ON a.id = l.account_id
            WHERE l.journal_entry_id = j.id
          ) line) AS lines
  FROM public.journal_entries j
  LEFT JOIN public.journal_entry_lines l ON l.journal_entry_id = j.id
  WHERE j.branch_id = p_branch_id
    AND (public.history_clamp_from(p_from_date) IS NULL OR j.entry_date >= public.history_clamp_from(p_from_date))
    AND (public.history_clamp_to(p_to_date) IS NULL OR j.entry_date <= public.history_clamp_to(p_to_date))
    AND (p_reference_type IS NULL OR j.reference_type = p_reference_type)
    AND (p_search IS NULL OR j.entry_number ILIKE '%' || p_search || '%'
                            OR j.reference_number ILIKE '%' || p_search || '%')
  GROUP BY j.id
) e;
$function$;

-- Harden get_general_ledger
CREATE OR REPLACE FUNCTION public.get_general_ledger(p_branch_id uuid, p_account_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.entry_date, row.entry_number, row.line_id), '[]'::jsonb)
FROM (
  SELECT l.id AS line_id, j.entry_date, j.entry_number, j.description, j.reference_number,
         l.debit, l.credit,
         round(SUM(
           CASE WHEN a.account_type IN ('asset', 'expense') THEN l.debit - l.credit
                ELSE l.credit - l.debit END
         ) OVER (ORDER BY j.entry_date, j.entry_number, l.id), 2) AS balance
  FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id = l.journal_entry_id
  JOIN public.chart_of_accounts a ON a.id = l.account_id
  WHERE l.account_id = p_account_id AND j.branch_id = p_branch_id
    AND (public.history_clamp_from(p_from_date) IS NULL OR j.entry_date >= public.history_clamp_from(p_from_date))
    AND (public.history_clamp_to(p_to_date) IS NULL OR j.entry_date <= public.history_clamp_to(p_to_date))
) row;
$function$;

-- Harden get_income_statement
CREATE OR REPLACE FUNCTION public.get_income_statement(p_branch_id uuid, p_from_date date, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH cfg AS (
  SELECT
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'revenue')        AS revenue_id,
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'other_income')   AS other_income_id,
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'discount_given') AS discount_id,
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'cogs')           AS cogs_id
), agg AS (
  SELECT a.account_type, a.id AS account_id,
         COALESCE(SUM(l.debit), 0) AS debit,
         COALESCE(SUM(l.credit), 0) AS credit
  FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id = l.journal_entry_id
  JOIN public.chart_of_accounts a ON a.id = l.account_id
  WHERE j.branch_id = p_branch_id
    AND j.entry_date >= public.history_clamp_from(p_from_date) AND j.entry_date <= public.history_clamp_to(p_to_date)
  GROUP BY a.account_type, a.id
)
SELECT jsonb_build_object(
  'revenue',      round(COALESCE((SELECT SUM(credit - debit) FROM agg, cfg WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)), 0), 2),
  'discount',     round(COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.discount_id), 0), 2),
  'net_revenue',  round(
                    COALESCE((SELECT SUM(credit - debit) FROM agg, cfg WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.discount_id), 0), 2),
  'cogs',         round(COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.cogs_id), 0), 2),
  'gross_profit', round(
                    COALESCE((SELECT SUM(credit - debit) FROM agg, cfg WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.discount_id), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.cogs_id), 0), 2),
  'expenses',     round(COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_type = 'expense' AND account_id <> COALESCE(cfg.cogs_id, '00000000-0000-0000-0000-000000000000')), 0), 2),
  'net_income',   round(
                    COALESCE((SELECT SUM(credit - debit) FROM agg, cfg WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.discount_id), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.cogs_id), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_type = 'expense' AND account_id <> COALESCE(cfg.cogs_id, '00000000-0000-0000-0000-000000000000')), 0), 2)
)
FROM cfg;
$function$;

-- Harden get_cash_flow
CREATE OR REPLACE FUNCTION public.get_cash_flow(p_branch_id uuid, p_from_date date, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.account_name), '[]'::jsonb)
FROM (
  SELECT t.id AS treasury_account_id, t.account_name, t.account_type, a.code,
         round(COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE 0 END), 0), 2) AS inflow,
         round(COALESCE(SUM(CASE WHEN tx.from_account_id = t.id THEN tx.amount ELSE 0 END), 0), 2) AS outflow,
         round(COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE -tx.amount END), 0), 2) AS net
  FROM public.treasury_accounts t
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  LEFT JOIN public.treasury_transactions tx
    ON (tx.to_account_id = t.id OR tx.from_account_id = t.id)
   AND tx.branch_id = p_branch_id
   AND (tx.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_clamp_from(p_from_date) AND (tx.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_to(p_to_date)
  WHERE t.branch_id = p_branch_id AND t.is_active
  GROUP BY t.id, t.account_name, t.account_type, a.code
  HAVING COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE -tx.amount END), 0) <> 0
) row;
$function$;

-- Harden get_party_statement
CREATE OR REPLACE FUNCTION public.get_party_statement(p_branch_id uuid, p_side text, p_party_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH lines AS (
  SELECT jl.id AS line_id, jl.debit, jl.credit, j.entry_date, j.entry_number,
         j.reference_type, j.reference_number, j.description
  FROM public.journal_entry_lines jl
  JOIN public.journal_entries j ON j.id = jl.journal_entry_id
  WHERE j.branch_id = p_branch_id
    AND (public.history_min_date() IS NULL OR j.entry_date >= public.history_min_date())
    AND (CASE WHEN p_side = 'ap' THEN jl.supplier_id ELSE jl.customer_id END) = p_party_id
    AND (public.history_clamp_to(p_to_date) IS NULL OR j.entry_date <= public.history_clamp_to(p_to_date))
), run AS (
  SELECT line_id, entry_date, entry_number, reference_type, reference_number, description,
         round(debit, 2) AS debit, round(credit, 2) AS credit,
         round(SUM(CASE WHEN p_side = 'ap' THEN credit - debit ELSE debit - credit END)
               OVER (ORDER BY entry_date, entry_number, line_id), 2) AS balance
  FROM lines
)
SELECT jsonb_build_object(
  'party_id', p_party_id, 'side', p_side,
  'opening', round(COALESCE((SELECT SUM(CASE WHEN p_side = 'ap' THEN credit - debit ELSE debit - credit END)
                             FROM lines WHERE public.history_clamp_from(p_from_date) IS NOT NULL AND entry_date < public.history_clamp_from(p_from_date)), 0), 2),
  'rows', (SELECT COALESCE(jsonb_agg(r ORDER BY r.entry_date, r.entry_number), '[]'::jsonb)
           FROM (SELECT line_id, entry_date, entry_number, reference_type, reference_number,
                        description, debit, credit, balance
                 FROM run WHERE public.history_clamp_from(p_from_date) IS NULL OR entry_date >= public.history_clamp_from(p_from_date)) r)
);
$function$;

-- Harden get_trial_balance
CREATE OR REPLACE FUNCTION public.get_trial_balance(p_branch_id uuid, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.code), '[]'::jsonb)
FROM (
  SELECT a.code, a.name, a.name_en, a.account_type,
         round(COALESCE(SUM(l.debit), 0), 2) AS debit,
         round(COALESCE(SUM(l.credit), 0), 2) AS credit,
         round(COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0), 2) AS balance
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= public.history_clamp_as_of(p_to_date)
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.code, a.name, a.name_en, a.account_type
  HAVING COALESCE(SUM(l.debit), 0) <> 0 OR COALESCE(SUM(l.credit), 0) <> 0
) row;
$function$;

-- Harden get_trial_balance_summary
CREATE OR REPLACE FUNCTION public.get_trial_balance_summary(p_branch_id uuid, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH rows AS (
  SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= public.history_clamp_as_of(p_to_date)
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
    AND (COALESCE(l.debit, 0) <> 0 OR COALESCE(l.credit, 0) <> 0)
)
SELECT jsonb_build_object(
  'to_date', public.history_clamp_as_of(p_to_date),
  'total_debit', round(COALESCE((SELECT SUM(debit) FROM rows), 0), 2),
  'total_credit', round(COALESCE((SELECT SUM(credit) FROM rows), 0), 2),
  'balanced', round(COALESCE((SELECT SUM(debit) FROM rows), 0), 2)
              = round(COALESCE((SELECT SUM(credit) FROM rows), 0), 2)
);
$function$;

-- Harden get_balance_sheet
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH bal AS (
  SELECT a.account_type, a.code,
         COALESCE(SUM(l.debit), 0) AS debit,
         COALESCE(SUM(l.credit), 0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= public.history_clamp_as_of(p_as_of)
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.account_type, a.code
), summary AS (
  SELECT
    round(COALESCE(SUM(CASE WHEN account_type = 'asset' THEN debit - credit ELSE 0 END), 0), 2) AS assets,
    round(COALESCE(SUM(CASE WHEN account_type = 'liability' THEN credit - debit ELSE 0 END), 0), 2) AS liabilities,
    round(COALESCE(SUM(CASE WHEN code = '3000' THEN credit - debit ELSE 0 END), 0), 2) AS capital,
    round(COALESCE(SUM(CASE WHEN code = '3100' THEN credit - debit ELSE 0 END), 0), 2) AS retained,
    round(COALESCE(SUM(CASE WHEN account_type = 'income' THEN credit - debit ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN account_type = 'expense' THEN debit - credit ELSE 0 END), 0), 2) AS net_income
  FROM bal
)
SELECT jsonb_build_object(
  'assets', assets,
  'liabilities', liabilities,
  'capital', capital,
  'retained', retained,
  'net_income', net_income,
  'equity', round(capital + retained + net_income, 2),
  'balanced', round(assets - (liabilities + capital + retained + net_income), 2) = 0
)
FROM summary;
$function$;

-- Harden get_ar_aging
CREATE OR REPLACE FUNCTION public.get_ar_aging(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH source_rows AS (
  SELECT
    s.customer_id,
    (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0))::numeric AS open_amount,
    s.created_at::date AS source_date
  FROM public.sales s
  WHERE s.branch_id = p_branch_id
    AND s.status <> 'returned'
    AND (public.history_min_date() IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_min_date())
    AND (s.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_as_of(p_as_of)
    AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0

  UNION ALL

  SELECT
    e.customer_id,
    (e.amount - e.settled_amount)::numeric AS open_amount,
    e.occurred_at::date AS source_date
  FROM public.employee_receivable_entries e
  JOIN public.customers c ON c.id = e.customer_id
  WHERE e.branch_id = p_branch_id
    AND c.customer_type = 'employee'
    AND (public.history_min_date() IS NULL OR (e.occurred_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_min_date())
    AND (e.occurred_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_as_of(p_as_of)
    AND (e.amount - e.settled_amount) > 0
), aggregated AS (
  SELECT
    c.id AS customer_id,
    c.name,
    c.phone,
    round(SUM(sr.open_amount), 2) AS open_amount,
    round(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - sr.source_date) <= 30 THEN sr.open_amount ELSE 0 END), 2) AS bucket_0_30,
    round(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - sr.source_date) BETWEEN 31 AND 60 THEN sr.open_amount ELSE 0 END), 2) AS bucket_31_60,
    round(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - sr.source_date) BETWEEN 61 AND 90 THEN sr.open_amount ELSE 0 END), 2) AS bucket_61_90,
    round(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - sr.source_date) > 90 THEN sr.open_amount ELSE 0 END), 2) AS bucket_90_plus
  FROM source_rows sr
  JOIN public.customers c ON c.id = sr.customer_id
  WHERE c.branch_id = p_branch_id
  GROUP BY c.id, c.name, c.phone
)
SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.open_amount DESC, a.name), '[]'::jsonb)
FROM aggregated a;
$function$;

-- Harden get_ap_aging
CREATE OR REPLACE FUNCTION public.get_ap_aging(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.open_amount DESC), '[]'::jsonb)
FROM (
  SELECT s.id AS supplier_id, s.name, s.phone,
         sum(p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) AS open_amount,
         round(sum(CASE WHEN (public.history_clamp_as_of(p_as_of) - (p.created_at AT TIME ZONE 'Africa/Cairo')::date) <= 30 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_0_30,
         round(sum(CASE WHEN (public.history_clamp_as_of(p_as_of) - (p.created_at AT TIME ZONE 'Africa/Cairo')::date) BETWEEN 31 AND 60 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_31_60,
         round(sum(CASE WHEN (public.history_clamp_as_of(p_as_of) - (p.created_at AT TIME ZONE 'Africa/Cairo')::date) BETWEEN 61 AND 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_61_90,
         round(sum(CASE WHEN (public.history_clamp_as_of(p_as_of) - (p.created_at AT TIME ZONE 'Africa/Cairo')::date) > 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_90_plus
  FROM public.purchases p
  JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE p.branch_id = p_branch_id AND p.status = 'completed'
    AND (public.history_min_date() IS NULL OR (p.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_min_date())
    AND (p.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_as_of(p_as_of)
    AND (p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) > 0
  GROUP BY s.id, s.name, s.phone
) row;
$function$;

-- Harden get_aging_summary
CREATE OR REPLACE FUNCTION public.get_aging_summary(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH ar_source AS (
  SELECT
    (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0))::numeric AS open_amount,
    s.created_at::date AS source_date
  FROM public.sales s
  WHERE s.branch_id = p_branch_id
    AND s.status <> 'returned'
    AND (public.history_min_date() IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_min_date())
    AND (s.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_as_of(p_as_of)
    AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0

  UNION ALL

  SELECT
    (e.amount - e.settled_amount)::numeric AS open_amount,
    e.occurred_at::date AS source_date
  FROM public.employee_receivable_entries e
  JOIN public.customers c ON c.id = e.customer_id
  WHERE e.branch_id = p_branch_id
    AND c.customer_type = 'employee'
    AND (public.history_min_date() IS NULL OR (e.occurred_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_min_date())
    AND (e.occurred_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_as_of(p_as_of)
    AND (e.amount - e.settled_amount) > 0
), ar AS (
  SELECT
    round(COALESCE(SUM(open_amount), 0), 2) AS open_total,
    round(COALESCE(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - source_date) <= 30 THEN open_amount ELSE 0 END), 0), 2) AS bucket_0_30,
    round(COALESCE(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - source_date) BETWEEN 31 AND 60 THEN open_amount ELSE 0 END), 0), 2) AS bucket_31_60,
    round(COALESCE(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - source_date) BETWEEN 61 AND 90 THEN open_amount ELSE 0 END), 0), 2) AS bucket_61_90,
    round(COALESCE(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - source_date) > 90 THEN open_amount ELSE 0 END), 0), 2) AS bucket_90_plus
  FROM ar_source
), ap AS (
  SELECT
    round(COALESCE(SUM(p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)), 0), 2) AS open_total,
    round(COALESCE(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - (p.created_at AT TIME ZONE 'Africa/Cairo')::date) <= 30 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 0), 2) AS bucket_0_30,
    round(COALESCE(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - (p.created_at AT TIME ZONE 'Africa/Cairo')::date) BETWEEN 31 AND 60 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 0), 2) AS bucket_31_60,
    round(COALESCE(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - (p.created_at AT TIME ZONE 'Africa/Cairo')::date) BETWEEN 61 AND 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 0), 2) AS bucket_61_90,
    round(COALESCE(SUM(CASE WHEN (public.history_clamp_as_of(p_as_of) - (p.created_at AT TIME ZONE 'Africa/Cairo')::date) > 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 0), 2) AS bucket_90_plus
  FROM public.purchases p
  WHERE p.branch_id = p_branch_id
    AND p.status = 'completed'
    AND (public.history_min_date() IS NULL OR (p.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_min_date())
    AND (p.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_as_of(p_as_of)
    AND (p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) > 0
)
SELECT jsonb_build_object(
  'as_of', public.history_clamp_as_of(p_as_of),
  'ar_open', COALESCE((SELECT open_total FROM ar), 0),
  'ap_open', COALESCE((SELECT open_total FROM ap), 0),
  'ar', jsonb_build_object(
    '0_30', COALESCE((SELECT bucket_0_30 FROM ar), 0),
    '31_60', COALESCE((SELECT bucket_31_60 FROM ar), 0),
    '61_90', COALESCE((SELECT bucket_61_90 FROM ar), 0),
    '90_plus', COALESCE((SELECT bucket_90_plus FROM ar), 0)
  ),
  'ap', jsonb_build_object(
    '0_30', COALESCE((SELECT bucket_0_30 FROM ap), 0),
    '31_60', COALESCE((SELECT bucket_31_60 FROM ap), 0),
    '61_90', COALESCE((SELECT bucket_61_90 FROM ap), 0),
    '90_plus', COALESCE((SELECT bucket_90_plus FROM ap), 0)
  )
);
$function$;

-- Harden get_order_margin
CREATE OR REPLACE FUNCTION public.get_order_margin(p_branch_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(sale_id uuid, invoice_number text, branch_id uuid, sale_date date, total numeric, discount_amount numeric, cogs numeric, gross_margin numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch FROM public.users u WHERE u.id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.invoice_number,
    s.branch_id,
    s.created_at::date,
    COALESCE(s.total, 0),
    COALESCE(s.discount_amount, 0),
    COALESCE(-SUM(il.total_cost), 0)::numeric(16,2) AS cogs,
    round(COALESCE(s.total, 0) - COALESCE(-SUM(il.total_cost), 0), 2)::numeric(16,2) AS gross_margin
  FROM public.sales s
  LEFT JOIN public.inventory_ledger il
    ON il.reference_id = s.id AND il.entry_type = 'sale' AND il.reference_type = 'sale'
  WHERE (v_scope IS NULL OR s.branch_id = v_scope)
    AND (public.history_clamp_from(p_from) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_clamp_from(p_from))
    AND (public.history_clamp_to(p_to) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_to(p_to))
  GROUP BY s.id
  ORDER BY s.created_at DESC
  LIMIT 500;
END;
$function$;

-- Harden get_costing_sales_summary
CREATE OR REPLACE FUNCTION public.get_costing_sales_summary(p_branch_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH scoped_sales AS (
  SELECT
    s.id,
    GREATEST(COALESCE(s.total, 0) - COALESCE(s.tax_amount, 0), 0)::numeric AS net_sales
  FROM public.sales s
  WHERE (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND (public.history_clamp_from(p_from) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_clamp_from(p_from))
    AND (public.history_clamp_to(p_to) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_to(p_to))
    AND COALESCE(s.status, '') NOT IN ('returned', 'cancelled')
),
kitchen_costs AS (
  SELECT
    e.settled_sale_id AS sale_id,
    ROUND(
      COALESCE(
        SUM(
          CASE
            WHEN e.sent_quantity > 0 THEN
              COALESCE(e.total_cost, 0)
              * GREATEST(e.sent_quantity - COALESCE(e.voided_quantity, 0), 0)
              / e.sent_quantity
            ELSE 0
          END
        ),
        0
      ),
      2
    )::numeric AS cogs
  FROM public.order_kitchen_inventory_events e
  JOIN scoped_sales ss ON ss.id = e.settled_sale_id
  WHERE e.settled_sale_id IS NOT NULL
  GROUP BY e.settled_sale_id
),
legacy_costs AS (
  SELECT
    il.reference_id AS sale_id,
    GREATEST(COALESCE(-SUM(il.total_cost), 0), 0)::numeric AS cogs
  FROM public.inventory_ledger il
  JOIN scoped_sales ss ON ss.id = il.reference_id
  WHERE il.entry_type = 'sale'
    AND il.reference_type = 'sale'
  GROUP BY il.reference_id
),
resolved_costs AS (
  SELECT
    ss.id AS sale_id,
    CASE
      WHEN kc.sale_id IS NOT NULL THEN COALESCE(kc.cogs, 0)
      ELSE COALESCE(lc.cogs, 0)
    END::numeric AS cogs
  FROM scoped_sales ss
  LEFT JOIN kitchen_costs kc ON kc.sale_id = ss.id
  LEFT JOIN legacy_costs lc ON lc.sale_id = ss.id
),
totals AS (
  SELECT
    COUNT(*)::integer AS sales_count,
    ROUND(COALESCE(SUM(ss.net_sales), 0), 2) AS net_sales,
    ROUND(COALESCE(SUM(rc.cogs), 0), 2) AS cogs
  FROM scoped_sales ss
  LEFT JOIN resolved_costs rc ON rc.sale_id = ss.id
)
SELECT jsonb_build_object(
  'sales_count', sales_count,
  'net_sales', net_sales,
  'cogs', cogs,
  'ratio', CASE WHEN net_sales > 0 THEN ROUND(cogs * 100.0 / net_sales, 2) ELSE 0 END
)
FROM totals;
$function$;

-- Harden get_waste_report
CREATE OR REPLACE FUNCTION public.get_waste_report(p_branch_id uuid DEFAULT get_branch_id(), p_from_date date DEFAULT (CURRENT_DATE - '30 days'::interval), p_to_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(waste_category text, waste_type text, total_quantity numeric, total_cost numeric, entry_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('waste.report') THEN RAISE EXCEPTION 'PERMISSION_DENIED:waste.report'; END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
  RETURN QUERY SELECT wc.name,we.waste_type,sum(we.quantity),sum(we.total_cost),count(*)::bigint
  FROM public.waste_entries we JOIN public.waste_categories wc ON wc.id=we.waste_category_id
  WHERE we.branch_id=p_branch_id AND we.status='approved' AND we.created_at >= public.history_date_start(public.history_clamp_from(p_from_date))
    AND we.created_at < public.history_date_start(public.history_clamp_to(p_to_date) + 1) GROUP BY wc.name,we.waste_type ORDER BY sum(we.total_cost) DESC;
END;
$function$;

-- Harden get_cost_history
CREATE OR REPLACE FUNCTION public.get_cost_history(p_product_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, product_id uuid, old_cost numeric, new_cost numeric, changed_at timestamp with time zone, changed_by text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    ch.id,
    ch.product_id,
    ch.old_cost,
    ch.new_cost,
    ch.changed_at,
    COALESCE(NULLIF(btrim(u.username), ''), u.full_name, u.email, ''),
    ch.source
  FROM public.product_cost_history ch
  JOIN public.products p ON p.id = ch.product_id
  LEFT JOIN public.users u ON u.id = ch.changed_by
  WHERE ch.product_id = p_product_id
    AND (public.history_min_instant() IS NULL OR ch.changed_at >= public.history_min_instant())
    AND auth.uid() IS NOT NULL
    AND public.can_permission('reports.costing')
    AND (
      public.is_pos_admin()
      OR (p.branch_id IS NOT NULL AND public.user_may_access_branch(p.branch_id))
    )
  ORDER BY ch.changed_at DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1)
$function$;

-- Harden get_raw_material_cost_history
CREATE OR REPLACE FUNCTION public.get_raw_material_cost_history(p_raw_material_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(event_id text, raw_material_id uuid, raw_material_name text, branch_id uuid, unit_cost numeric, previous_cost numeric, change_amount numeric, change_pct numeric, price_source text, priced_at timestamp with time zone, reference_number text, source_detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_material_branch uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.can_permission('reports.costing') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT rm.branch_id
  INTO v_material_branch
  FROM public.raw_materials rm
  WHERE rm.id = p_raw_material_id;

  IF v_material_branch IS NULL THEN
    RETURN;
  END IF;
  IF p_branch_id IS NOT NULL AND p_branch_id <> v_material_branch THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  IF NOT public.user_may_access_branch(v_material_branch) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT e.*
    FROM public._raw_cost_events_for_costing(p_raw_material_id, v_material_branch) e
    WHERE public.history_min_instant() IS NULL OR e.priced_at >= public.history_min_instant()
  ),
  sequenced AS (
    SELECT
      e.*,
      LEAD(e.unit_cost) OVER (
        ORDER BY
          e.priced_at DESC NULLS LAST,
          e.source_rank,
          e.reference_number DESC NULLS LAST,
          e.event_id DESC
      ) AS previous_cost
    FROM events e
  )
  SELECT
    e.event_id,
    e.raw_material_id,
    COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material')::text,
    e.branch_id,
    e.unit_cost,
    e.previous_cost::numeric(18,6),
    CASE
      WHEN e.previous_cost IS NULL THEN NULL
      ELSE (e.unit_cost - e.previous_cost)::numeric(18,6)
    END,
    CASE
      WHEN COALESCE(e.previous_cost, 0) <= 0 THEN NULL
      ELSE round(
        (e.unit_cost - e.previous_cost) * 100.0 / e.previous_cost,
        4
      )::numeric(12,4)
    END,
    e.source,
    e.priced_at,
    e.reference_number,
    e.detail
  FROM sequenced e
  JOIN public.raw_materials rm ON rm.id = e.raw_material_id
  ORDER BY
    e.priced_at DESC NULLS LAST,
    e.source_rank,
    e.reference_number DESC NULLS LAST,
    e.event_id DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
END;
$function$;

-- Harden get_supplier_price_impact
CREATE OR REPLACE FUNCTION public.get_supplier_price_impact(p_supplier_id uuid)
 RETURNS TABLE(item_id uuid, item_type text, item_name text, first_cost numeric, last_cost numeric, avg_cost numeric, change_pct numeric, purchase_count bigint, last_purchased_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    p.id,
    'product'::text AS item_type,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product'),
    (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]::numeric(12,2),
    (array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1]::numeric(12,2),
    round(AVG(pi.unit_cost), 2)::numeric(12,2),
    round(CASE
      WHEN (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1] > 0
      THEN ((array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1] - (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]) * 100.0
        / (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]
      ELSE 0 END, 2)::numeric(10,2),
    COUNT(*)::bigint,
    MAX(pc.created_at)::timestamptz
  FROM public.purchase_items pi
  JOIN public.purchases pc ON pc.id = pi.purchase_id
  JOIN public.products p ON p.id = pi.product_id
  WHERE pc.supplier_id = p_supplier_id
    AND pc.status = 'completed'
    AND (public.history_min_instant() IS NULL OR pc.created_at >= public.history_min_instant())
    AND pi.product_id IS NOT NULL
    AND (public.is_pos_admin() OR pc.branch_id = public.get_branch_id())
  GROUP BY p.id
  UNION ALL
  SELECT
    rm.id,
    'raw_material'::text AS item_type,
    COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
    (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]::numeric(12,2),
    (array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1]::numeric(12,2),
    round(AVG(pi.unit_cost), 2)::numeric(12,2),
    round(CASE
      WHEN (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1] > 0
      THEN ((array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1] - (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]) * 100.0
        / (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]
      ELSE 0 END, 2)::numeric(10,2),
    COUNT(*)::bigint,
    MAX(pc.created_at)::timestamptz
  FROM public.purchase_items pi
  JOIN public.purchases pc ON pc.id = pi.purchase_id
  JOIN public.raw_materials rm ON rm.id = pi.raw_material_id
  WHERE pc.supplier_id = p_supplier_id
    AND pc.status = 'completed'
    AND (public.history_min_instant() IS NULL OR pc.created_at >= public.history_min_instant())
    AND pi.raw_material_id IS NOT NULL
    AND (public.is_pos_admin() OR pc.branch_id = public.get_branch_id())
  GROUP BY rm.id
  ORDER BY 2 ASC, 3 ASC
$function$;

-- Keep historical RPCs off PUBLIC/anon while retaining application/service access.
REVOKE ALL ON FUNCTION public.get_aging_summary(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ap_aging(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ar_aging(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_balance_sheet(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cash_flow(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cost_history(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_costing_sales_summary(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_general_ledger(uuid, uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_income_statement(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_journals(uuid, date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_order_margin(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_party_statement(uuid, text, uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_raw_material_cost_history(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_supplier_price_impact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_trial_balance(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_trial_balance_summary(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_waste_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_aging_summary(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ap_aging(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ar_aging(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cash_flow(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cost_history(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_costing_sales_summary(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_general_ledger(uuid, uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_income_statement(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_journals(uuid, date, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_order_margin(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_party_statement(uuid, text, uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_raw_material_cost_history(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_supplier_price_impact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_trial_balance(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_trial_balance_summary(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_waste_report(uuid, date, date) TO authenticated, service_role;

COMMIT;
