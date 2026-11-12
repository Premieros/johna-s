-- Opt-in second CASHIER on the SAME Windows agent. No kitchen/bar or claim protocol changes.
CREATE TABLE public.cashier_print_stations (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  secondary_name text NOT NULL CHECK (length(btrim(secondary_name)) BETWEEN 1 AND 70),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.cashier_area_routes (
  area_id uuid PRIMARY KEY REFERENCES public.dining_areas(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.cashier_print_stations(branch_id) ON DELETE CASCADE
);
ALTER TABLE public.cashier_print_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_print_stations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_area_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_area_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY cashier_station_read ON public.cashier_print_stations FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));
CREATE POLICY cashier_station_manage ON public.cashier_print_stations FOR ALL TO authenticated
  USING (public.user_may_access_branch(branch_id) AND public.can_permission('settings.manage'))
  WITH CHECK (public.user_may_access_branch(branch_id) AND public.can_permission('settings.manage'));
CREATE POLICY cashier_area_read ON public.cashier_area_routes FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));
CREATE POLICY cashier_area_manage ON public.cashier_area_routes FOR ALL TO authenticated
  USING (public.user_may_access_branch(branch_id) AND public.can_permission('settings.manage'))
  WITH CHECK (public.user_may_access_branch(branch_id) AND public.can_permission('settings.manage')
    AND EXISTS (SELECT 1 FROM public.dining_areas a WHERE a.id=area_id AND a.branch_id=cashier_area_routes.branch_id));
REVOKE ALL ON public.cashier_print_stations, public.cashier_area_routes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashier_print_stations, public.cashier_area_routes TO authenticated;

CREATE FUNCTION public.get_cashier_area_settings(p_branch_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH'); END IF;
  IF NOT public.can_permission('settings.manage') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
  RETURN jsonb_build_object('success',true,
    'station',(SELECT to_jsonb(s) FROM public.cashier_print_stations s WHERE branch_id=p_branch_id),
    'areas',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'secondary',r.area_id IS NOT NULL) ORDER BY a.name,a.id)
      FROM public.dining_areas a LEFT JOIN public.cashier_area_routes r ON r.area_id=a.id AND r.branch_id=p_branch_id WHERE a.branch_id=p_branch_id),'[]'::jsonb));
END $$;
CREATE FUNCTION public.save_cashier_area_settings(p_branch_id uuid,p_name text,p_enabled boolean,p_area_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH'); END IF;
  IF NOT public.can_permission('settings.manage') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 70 OR p_enabled IS NULL THEN RETURN jsonb_build_object('success',false,'error','INVALID_STATION'); END IF;
  IF cardinality(p_area_ids)>100 OR EXISTS(SELECT 1 FROM unnest(p_area_ids) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM public.dining_areas a WHERE a.id=x AND a.branch_id=p_branch_id)) THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_AREA');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cashier-area:'||p_branch_id::text,0));
  INSERT INTO public.cashier_print_stations(branch_id,secondary_name,enabled) VALUES(p_branch_id,btrim(p_name),p_enabled)
    ON CONFLICT(branch_id) DO UPDATE SET secondary_name=excluded.secondary_name,enabled=excluded.enabled,updated_at=now();
  DELETE FROM public.cashier_area_routes WHERE branch_id=p_branch_id;
  INSERT INTO public.cashier_area_routes(branch_id,area_id) SELECT p_branch_id,x FROM (SELECT DISTINCT unnest(p_area_ids) x) q;
  RETURN jsonb_build_object('success',true);
END $$;
CREATE FUNCTION public.resolve_cashier_area_station(p_branch_id uuid,p_table_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM public.dining_tables t JOIN public.dining_areas a ON a.id=t.area_id AND a.branch_id=t.branch_id
    JOIN public.cashier_area_routes r ON r.area_id=a.id AND r.branch_id=t.branch_id
    JOIN public.cashier_print_stations s ON s.branch_id=r.branch_id AND s.enabled
    WHERE t.id=p_table_id AND t.branch_id=p_branch_id
  ) THEN 'cashier_2' ELSE 'cashier' END;
$$;
REVOKE ALL ON FUNCTION public.get_cashier_area_settings(uuid), public.save_cashier_area_settings(uuid,text,boolean,uuid[]), public.resolve_cashier_area_station(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_cashier_area_settings(uuid), public.save_cashier_area_settings(uuid,text,boolean,uuid[]), public.resolve_cashier_area_station(uuid,uuid) TO authenticated;

-- Patch only receipt destination literals. Preserve authorizations, idempotency,
-- pending-job reuse and all other enqueue behavior, fail closed on source drift.
DO $patch$
DECLARE d text; old text; newer text;
BEGIN
 SELECT pg_get_functiondef('public.enqueue_cloud_receipt_print(uuid,uuid,jsonb,text)'::regprocedure) INTO d;
 old := $$v_sale.branch_id, auth.uid(), 'receipt', 'cashier', p_payload, p_sale_id,$$;
 newer := $$v_sale.branch_id, auth.uid(), 'receipt', public.resolve_cashier_area_station(v_sale.branch_id,v_sale.table_id), p_payload, p_sale_id,$$;
 IF (length(d)-length(replace(d,old,'')))/length(old) <> 1 THEN RAISE EXCEPTION 'cashier sale enqueue drift'; END IF;
 EXECUTE replace(d,old,newer);
 SELECT pg_get_functiondef('public.enqueue_cloud_open_order_print(uuid,jsonb,text)'::regprocedure) INTO d;
 old := $$v_order.branch_id,v_uid,'receipt','cashier',$$;
 newer := $$v_order.branch_id,v_uid,'receipt',public.resolve_cashier_area_station(v_order.branch_id,v_order.table_id),$$;
 IF (length(d)-length(replace(d,old,'')))/length(old) <> 1 THEN RAISE EXCEPTION 'cashier order enqueue drift'; END IF;
 d := replace(d,old,newer);
 old := $$'station_code','cashier'$$;
 IF (length(d)-length(replace(d,old,'')))/length(old) <> 1 THEN RAISE EXCEPTION 'cashier response drift'; END IF;
 EXECUTE replace(d,old,$$'station_code',v_job.station_code$$);
END $patch$;
