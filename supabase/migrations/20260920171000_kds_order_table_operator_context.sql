-- Read-only KDS display context for table/operator labels.
-- This does not change kitchen sending, station routing, printing, inventory, or status transitions.

CREATE OR REPLACE FUNCTION public.get_kitchen_order_context(
  p_order_ids uuid[],
  p_branch_id uuid DEFAULT public.get_branch_id()
)
RETURNS TABLE(
  order_id uuid,
  table_name text,
  operator_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  IF p_branch_id IS NULL
     OR p_order_ids IS NULL
     OR cardinality(p_order_ids) = 0
     OR (NOT v_is_service_role AND auth.uid() IS NULL)
     OR (NOT v_is_service_role AND NOT public.user_may_access_branch(p_branch_id))
     OR (NOT v_is_service_role AND NOT public.can_permission('pos.kds_view')) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    dt.name,
    COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.email), ''))
  FROM public.orders o
  LEFT JOIN public.dining_tables dt
    ON dt.id = o.table_id
   AND dt.branch_id = o.branch_id
  LEFT JOIN public.users u
    ON u.id = o.cashier_id
  WHERE o.branch_id = p_branch_id
    AND o.id = ANY(p_order_ids)
    AND EXISTS (
      SELECT 1
      FROM public.get_kitchen_queue(NULL::text, p_branch_id) q
      WHERE q.order_id = o.id
    )
  ORDER BY o.created_at, o.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_kitchen_order_context(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kitchen_order_context(uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kitchen_order_context(uuid[], uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_kitchen_order_context(uuid[], uuid) IS
  'Read-only KDS card context: table name and order operator, scoped through the same visible kitchen queue.';

NOTIFY pgrst, 'reload schema';
