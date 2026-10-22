-- Read-only report repair. Preserve invoker permissions and existing one-pass journal aggregation.
BEGIN;
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_income_statement(uuid,date,date)'::regprocedure) <> 'c184b65ea4f5a782a6dd0bf395d20539'
 THEN RAISE EXCEPTION 'INCOME_STATEMENT_SOURCE_DRIFT'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_income_statement(p_branch_id uuid, p_from_date date, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH history_bounds AS MATERIALIZED (
  SELECT
    public.history_clamp_from(p_from_date) AS from_date,
    public.history_clamp_to(p_to_date) AS to_date
),
cfg AS MATERIALIZED (
  SELECT
    (SELECT account_id
       FROM public.account_mappings
      WHERE branch_id = p_branch_id
        AND semantic_key = 'revenue') AS revenue_id,
    (SELECT account_id
       FROM public.account_mappings
      WHERE branch_id = p_branch_id
        AND semantic_key = 'other_income') AS other_income_id,
    (SELECT account_id
       FROM public.account_mappings
      WHERE branch_id = p_branch_id
        AND semantic_key = 'discount_given') AS discount_id,
    (SELECT account_id
       FROM public.account_mappings
      WHERE branch_id = p_branch_id
        AND semantic_key = 'cogs') AS cogs_id
),
agg AS MATERIALIZED (
  SELECT
    a.account_type,
    a.id AS account_id,
    COALESCE(SUM(l.debit), 0) AS debit,
    COALESCE(SUM(l.credit), 0) AS credit
  FROM public.journal_entry_lines l
  JOIN public.journal_entries j
    ON j.id = l.journal_entry_id
  JOIN public.chart_of_accounts a
    ON a.id = l.account_id
  CROSS JOIN history_bounds hb
  WHERE j.branch_id = p_branch_id
    AND j.entry_date >= hb.from_date
    AND j.entry_date <= hb.to_date
  GROUP BY a.account_type, a.id
)
 , totals AS (
  SELECT
    COALESCE(SUM(credit-debit) FILTER (WHERE account_id=cfg.revenue_id),0) AS revenue,
    COALESCE(SUM(debit-credit) FILTER (WHERE account_id=cfg.discount_id),0) AS discount,
    COALESCE(SUM(debit-credit) FILTER (WHERE account_id=cfg.cogs_id),0) AS cogs,
    COALESCE(SUM(credit-debit) FILTER (WHERE account_type='income'
      AND account_id IS DISTINCT FROM cfg.revenue_id
      AND account_id IS DISTINCT FROM cfg.discount_id),0) AS other_income,
    COALESCE(SUM(debit-credit) FILTER (WHERE account_type='expense'
      AND account_id IS DISTINCT FROM cfg.cogs_id
      AND account_id IS DISTINCT FROM cfg.discount_id),0) AS expenses,
    COALESCE(SUM(CASE WHEN account_type='income' THEN credit-debit
                      WHEN account_type='expense' THEN credit-debit ELSE 0 END),0) AS net_income
  FROM agg CROSS JOIN cfg
)
SELECT jsonb_build_object(
  'revenue',round(revenue,2),
  'discount',round(discount,2),
  'net_revenue',round(revenue-discount,2),
  'cogs',round(cogs,2),
  'gross_profit',round(revenue-discount-cogs,2),
  'other_income',round(other_income,2),
  'expenses',round(expenses,2),
  'net_income',round(net_income,2)
) FROM totals;
$function$;

-- Deactivating an account must not erase its historical balances.
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_balance_sheet(uuid,date)'::regprocedure) <> '01a5e6f5ee5fc2d124b61614da128004'
 THEN RAISE EXCEPTION 'BALANCE_SHEET_SOURCE_DRIFT'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH bal AS (
  SELECT
    a.account_type,
    a.code,
    COALESCE(SUM(l.debit),0) AS debit,
    COALESCE(SUM(l.credit),0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id,l.debit,l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id=l.journal_entry_id
    WHERE j.branch_id=p_branch_id
      AND j.entry_date<=public.history_clamp_as_of(p_as_of)
  ) l ON l.account_id=a.id
  WHERE a.branch_id=p_branch_id
  GROUP BY a.account_type,a.code
), summary AS (
  SELECT
    round(COALESCE(SUM(CASE WHEN account_type='asset' THEN debit-credit ELSE 0 END),0),2) AS assets,
    round(COALESCE(SUM(CASE WHEN account_type='liability' THEN credit-debit ELSE 0 END),0),2) AS liabilities,
    round(COALESCE(SUM(CASE WHEN code='3000' THEN credit-debit ELSE 0 END),0),2) AS capital,
    round(COALESCE(SUM(CASE WHEN code='3100' THEN credit-debit ELSE 0 END),0),2) AS retained,
    round(COALESCE(SUM(CASE WHEN code='3200' THEN credit-debit ELSE 0 END),0),2) AS opening_equity,
    round(
      COALESCE(SUM(CASE WHEN account_type='income' THEN credit-debit ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN account_type='expense' THEN debit-credit ELSE 0 END),0),
      2
    ) AS net_income
  FROM bal
)
SELECT jsonb_build_object(
  'assets',assets,
  'liabilities',liabilities,
  'capital',capital,
  'retained',retained,
  'opening_equity',opening_equity,
  'net_income',net_income,
  'equity',round(capital+retained+opening_equity+net_income,2),
  'balanced',round(assets-(liabilities+capital+retained+opening_equity+net_income),2)=0
)
FROM summary;
$function$;
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_trial_balance(uuid,date)'::regprocedure) <> '5ccadb0fc728fab3a28ddb13e5b3619c'
 THEN RAISE EXCEPTION 'TRIAL_BALANCE_SOURCE_DRIFT'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_trial_balance(p_branch_id uuid, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH history_bound AS MATERIALIZED (
  SELECT public.history_clamp_as_of(p_to_date) AS to_date
),
rows AS MATERIALIZED (
  SELECT
    a.code,
    a.name,
    a.name_en,
    a.account_type,
    round(COALESCE(SUM(l.debit), 0), 2) AS debit,
    round(COALESCE(SUM(l.credit), 0), 2) AS credit,
    round(
      COALESCE(SUM(l.debit), 0)
      - COALESCE(SUM(l.credit), 0),
      2
    ) AS balance
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    CROSS JOIN history_bound hb
    WHERE j.branch_id = p_branch_id
      AND j.entry_date <= hb.to_date
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id
  GROUP BY a.code, a.name, a.name_en, a.account_type
  HAVING COALESCE(SUM(l.debit), 0) <> 0
      OR COALESCE(SUM(l.credit), 0) <> 0
)
SELECT COALESCE(jsonb_agg(rows ORDER BY code), '[]'::jsonb)
FROM rows;
$function$;
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_trial_balance_summary(uuid,date)'::regprocedure) <> '8714c9c96f42dcf5af5561db349decc2'
 THEN RAISE EXCEPTION 'TRIAL_BALANCE_SOURCE_DRIFT'; END IF;
END $guard$;
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
  WHERE a.branch_id = p_branch_id
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
COMMIT;
