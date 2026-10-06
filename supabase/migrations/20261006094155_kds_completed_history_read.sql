-- Additive bounded, read-only KDS history. No changes to dispatch, serving or printing.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
CREATE FUNCTION public.get_kitchen_completed_history(
  p_branch_id uuid, p_from_ts timestamptz, p_to_ts timestamptz,
  p_station text DEFAULT NULL, p_page integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $function$
DECLARE v_result jsonb; v_has_assignments boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
  IF NOT public.can_permission('pos.kds_view') THEN RAISE EXCEPTION 'POS_KDS_VIEW_REQUIRED'; END IF;
  IF p_from_ts IS NULL OR p_to_ts IS NULL OR p_from_ts>=p_to_ts THEN RAISE EXCEPTION 'REPORT_PERIOD_INVALID'; END IF;
  IF p_page IS NULL OR p_page<0 OR p_page>1000000 THEN RAISE EXCEPTION 'REPORT_PAGE_INVALID'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_kitchen_station_assignments a
    WHERE a.user_id=auth.uid() AND a.branch_id=p_branch_id) INTO v_has_assignments;
  v_has_assignments := v_has_assignments AND NOT public.can_permission('settings.manage');
  WITH allowed_stations AS MATERIALIZED (
    SELECT s.id,s.code FROM jsonb_to_recordset(public.get_my_kitchen_stations(p_branch_id)) AS s(id uuid,code text)
    WHERE p_station IS NULL OR s.code=p_station
  ), filtered AS MATERIALIZED (
    SELECT o.id AS order_id,o.order_number,CASE WHEN o.status='cancelled' THEN 'cancelled' ELSE o.kitchen_status END AS kitchen_status,o.updated_at,o.kitchen_sent_at,o.table_id
    FROM public.orders o
    WHERE o.branch_id=p_branch_id AND (o.kitchen_status IN ('served','cancelled') OR (o.status='cancelled' AND o.kitchen_sent_at IS NOT NULL))
      AND o.updated_at>=p_from_ts AND o.updated_at<p_to_ts
      AND (
        (NOT v_has_assignments AND p_station IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.order_items oi
          JOIN public.order_kitchen_sends oks ON oks.order_item_id=oi.id AND oks.order_id=o.id AND oks.branch_id=o.branch_id
          JOIN public.products pr ON pr.id=oi.product_id
          LEFT JOIN public.categories c ON c.id=pr.category_id AND c.branch_id=o.branch_id
          LEFT JOIN public.kitchen_stations ks ON ks.id=c.kitchen_station_id AND ks.branch_id=o.branch_id AND ks.is_active
          WHERE oi.order_id=o.id AND EXISTS (
            SELECT 1 FROM allowed_stations a WHERE a.code=COALESCE(ks.code,'main')
          )
        )
        OR (
          NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id)
          AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_sends oks WHERE oks.order_id=o.id)
          AND EXISTS(SELECT 1 FROM allowed_stations a WHERE lower(btrim(a.code))=lower(btrim(COALESCE(NULLIF(o.station,''),'main'))))
        )
      )
  ), page AS MATERIALIZED (
    SELECT * FROM filtered ORDER BY updated_at DESC,order_id DESC LIMIT 100 OFFSET p_page::bigint*100
  ), details AS (
    SELECT to_jsonb(p)-'table_id'||jsonb_build_object('table_name',dt.name) AS row,p.updated_at,p.order_id
    FROM page p LEFT JOIN public.dining_tables dt ON dt.id=p.table_id AND dt.branch_id=p_branch_id
  )
  SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(row ORDER BY updated_at DESC,order_id DESC) FROM details),'[]'::jsonb),'count',(SELECT count(*) FROM filtered)) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_kitchen_completed_history(uuid,timestamptz,timestamptz,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_kitchen_completed_history(uuid,timestamptz,timestamptz,text,integer) TO authenticated,service_role;
COMMENT ON FUNCTION public.get_kitchen_completed_history(uuid,timestamptz,timestamptz,text,integer) IS '100-row KDS completed history, current caller RLS, branch and allowed station scope. Filters on last update; no operational writes.';
COMMIT;
