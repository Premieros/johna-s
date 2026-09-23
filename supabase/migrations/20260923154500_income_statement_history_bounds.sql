-- Performance stabilization: evaluate income-statement history bounds once per RPC call.
-- Production read-only evidence on 2026-09-23:
--   current get_income_statement(Cleopatra, 2026-09-01..2026-09-23): ~137 ms
--   equivalent query with materialized history bounds: ~8.4 ms
-- Exact JSON equality was verified for Cleopatra and Smouha.
--
-- Security semantics are preserved:
-- - SECURITY INVOKER behavior remains unchanged.
-- - search_path remains public, pg_temp.
-- - authenticated/service_role EXECUTE grants remain; anon stays revoked.
-- - history permission semantics remain unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_income_statement(
  p_branch_id uuid,
  p_from_date date,
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.get_income_statement(uuid,date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_income_statement(uuid,date,date)
  TO authenticated, service_role;

COMMIT;
