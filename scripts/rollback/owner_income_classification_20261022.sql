BEGIN;
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_income_statement(uuid,date,date)'::regprocedure) <> '6b60e704bfc8e99f71db079958bd8949'
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
SELECT jsonb_build_object(
  'revenue',
    round(
      COALESCE(
        (SELECT SUM(credit - debit)
           FROM agg, cfg
          WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)),
        0
      ),
      2
    ),
  'discount',
    round(
      COALESCE(
        (SELECT SUM(debit - credit)
           FROM agg, cfg
          WHERE account_id = cfg.discount_id),
        0
      ),
      2
    ),
  'net_revenue',
    round(
      COALESCE(
        (SELECT SUM(credit - debit)
           FROM agg, cfg
          WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)),
        0
      )
      - COALESCE(
          (SELECT SUM(debit - credit)
             FROM agg, cfg
            WHERE account_id = cfg.discount_id),
          0
        ),
      2
    ),
  'cogs',
    round(
      COALESCE(
        (SELECT SUM(debit - credit)
           FROM agg, cfg
          WHERE account_id = cfg.cogs_id),
        0
      ),
      2
    ),
  'gross_profit',
    round(
      COALESCE(
        (SELECT SUM(credit - debit)
           FROM agg, cfg
          WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)),
        0
      )
      - COALESCE(
          (SELECT SUM(debit - credit)
             FROM agg, cfg
            WHERE account_id = cfg.discount_id),
          0
        )
      - COALESCE(
          (SELECT SUM(debit - credit)
             FROM agg, cfg
            WHERE account_id = cfg.cogs_id),
          0
        ),
      2
    ),
  'expenses',
    round(
      COALESCE(
        (
          SELECT SUM(debit - credit)
          FROM agg, cfg
          WHERE account_type = 'expense'
            AND account_id <> COALESCE(
              cfg.cogs_id,
              '00000000-0000-0000-0000-000000000000'
            )
        ),
        0
      ),
      2
    ),
  'net_income',
    round(
      COALESCE(
        (SELECT SUM(credit - debit)
           FROM agg, cfg
          WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)),
        0
      )
      - COALESCE(
          (SELECT SUM(debit - credit)
             FROM agg, cfg
            WHERE account_id = cfg.discount_id),
          0
        )
      - COALESCE(
          (SELECT SUM(debit - credit)
             FROM agg, cfg
            WHERE account_id = cfg.cogs_id),
          0
        )
      - COALESCE(
          (
            SELECT SUM(debit - credit)
            FROM agg, cfg
            WHERE account_type = 'expense'
              AND account_id <> COALESCE(
                cfg.cogs_id,
                '00000000-0000-0000-0000-000000000000'
              )
          ),
          0
        ),
      2
    )
)
FROM cfg;
$function$;

DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_balance_sheet(uuid,date)'::regprocedure) <> 'faa786bfa2ff9b7ef5977e1001290cf1'
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
    AND a.is_active
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
COMMIT;
