-- Performance stabilization: evaluate raw-material branch access once per branch.
-- Production read-only evidence on 2026-09-23:
--   warm get_raw_material_cost_overview(Cleopatra): ~78-85 ms
--   equivalent branch-gated query: ~36 ms
--   first observed cold run: ~1.08 s
-- Exact row/count/hash equality was verified for Cleopatra and all accessible branches.
--
-- Security semantics are preserved:
-- - AUTH_REQUIRED and reports.costing checks are unchanged.
-- - Explicit p_branch_id still raises BRANCH_MISMATCH when inaccessible.
-- - p_branch_id = NULL still returns only branches allowed by user_may_access_branch().
-- - SECURITY DEFINER, search_path, and EXECUTE grants are unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_raw_material_cost_overview(
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  raw_material_id uuid,
  raw_material_name text,
  raw_material_code text,
  branch_id uuid,
  latest_cost numeric,
  previous_cost numeric,
  change_amount numeric,
  change_pct numeric,
  price_source text,
  priced_at timestamptz,
  reference_number text,
  source_detail text,
  event_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.can_permission('reports.costing') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_branch_id IS NOT NULL
     AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  WITH accessible_branches AS MATERIALIZED (
    SELECT b.id AS branch_id
    FROM public.branches b
    WHERE (p_branch_id IS NULL OR b.id = p_branch_id)
      AND (
        p_branch_id IS NOT NULL
        OR public.user_may_access_branch(b.id)
      )
  ),
  scoped_materials AS MATERIALIZED (
    SELECT
      rm.id,
      rm.name,
      rm.code,
      rm.branch_id,
      rm.default_cost
    FROM public.raw_materials rm
    JOIN accessible_branches ab
      ON ab.branch_id = rm.branch_id
    WHERE rm.is_active = true
  ),
  scoped_branches AS MATERIALIZED (
    SELECT DISTINCT sm.branch_id
    FROM scoped_materials sm
  ),
  events AS MATERIALIZED (
    SELECT e.*
    FROM public._raw_cost_events_for_costing(NULL, p_branch_id) e
    JOIN scoped_branches sb ON sb.branch_id = e.branch_id
  ),
  ranked AS MATERIALIZED (
    SELECT
      e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.raw_material_id, e.branch_id
        ORDER BY
          e.priced_at DESC NULLS LAST,
          e.source_rank,
          e.reference_number DESC NULLS LAST,
          e.event_id DESC
      ) AS rn,
      COUNT(*) OVER (
        PARTITION BY e.raw_material_id, e.branch_id
      )::bigint AS event_count
    FROM events e
  ),
  inventory_latest AS MATERIALIZED (
    SELECT DISTINCT ON (rmi.raw_material_id, rmi.branch_id)
      rmi.raw_material_id,
      rmi.branch_id,
      rmi.avg_cost::numeric(18,6) AS unit_cost,
      rmi.updated_at AS priced_at
    FROM public.raw_material_inventory rmi
    JOIN scoped_materials sm
      ON sm.id = rmi.raw_material_id
     AND sm.branch_id = rmi.branch_id
    WHERE COALESCE(rmi.avg_cost, 0) > 0
    ORDER BY
      rmi.raw_material_id,
      rmi.branch_id,
      rmi.updated_at DESC NULLS LAST,
      rmi.id DESC
  ),
  batch_average AS MATERIALIZED (
    SELECT
      b.raw_material_id,
      b.branch_id,
      NULLIF(
        SUM(b.quantity * COALESCE(b.unit_cost, 0))
        / NULLIF(SUM(b.quantity), 0),
        0
      )::numeric(18,6) AS unit_cost,
      MAX(b.created_at) AS priced_at
    FROM public.raw_material_batches b
    JOIN scoped_materials sm
      ON sm.id = b.raw_material_id
     AND sm.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.raw_material_id, b.branch_id
  )
  SELECT
    sm.id,
    COALESCE(NULLIF(btrim(sm.name), ''), 'Raw Material')::text,
    sm.code::text,
    sm.branch_id,
    COALESCE(
      r1.unit_cost,
      inv.unit_cost,
      ba.unit_cost,
      sm.default_cost,
      0
    )::numeric(18,6) AS latest_cost,
    r2.unit_cost::numeric(18,6) AS previous_cost,
    CASE
      WHEN r2.unit_cost IS NULL THEN NULL
      ELSE (
        COALESCE(
          r1.unit_cost,
          inv.unit_cost,
          ba.unit_cost,
          sm.default_cost,
          0
        ) - r2.unit_cost
      )::numeric(18,6)
    END AS change_amount,
    CASE
      WHEN COALESCE(r2.unit_cost, 0) <= 0 THEN NULL
      ELSE round(
        (
          COALESCE(
            r1.unit_cost,
            inv.unit_cost,
            ba.unit_cost,
            sm.default_cost,
            0
          ) - r2.unit_cost
        ) * 100.0 / r2.unit_cost,
        4
      )::numeric(12,4)
    END AS change_pct,
    COALESCE(
      r1.source,
      CASE
        WHEN inv.unit_cost IS NOT NULL THEN 'inventory_average'
        WHEN ba.unit_cost IS NOT NULL THEN 'batch_average'
        ELSE 'default_cost'
      END
    )::text AS price_source,
    CASE
      WHEN r1.event_id IS NOT NULL THEN r1.priced_at
      WHEN inv.unit_cost IS NOT NULL THEN inv.priced_at
      WHEN ba.unit_cost IS NOT NULL THEN ba.priced_at
      ELSE NULL
    END AS priced_at,
    r1.reference_number::text,
    r1.detail::text,
    COALESCE(r1.event_count, 0)::bigint
  FROM scoped_materials sm
  LEFT JOIN ranked r1
    ON r1.raw_material_id = sm.id
   AND r1.branch_id = sm.branch_id
   AND r1.rn = 1
  LEFT JOIN ranked r2
    ON r2.raw_material_id = sm.id
   AND r2.branch_id = sm.branch_id
   AND r2.rn = 2
  LEFT JOIN inventory_latest inv
    ON inv.raw_material_id = sm.id
   AND inv.branch_id = sm.branch_id
  LEFT JOIN batch_average ba
    ON ba.raw_material_id = sm.id
   AND ba.branch_id = sm.branch_id
  ORDER BY sm.name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_raw_material_cost_overview(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_cost_overview(uuid)
  TO authenticated, service_role;

COMMIT;
