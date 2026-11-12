-- Operational consumption prices: bounded movement quantities, one latest-price
-- lookup per consumed raw material. Same report permission boundary as the old
-- reporting RPC; no stock/FIFO/journal or historical valuation writes.
CREATE FUNCTION public.get_raw_consumption_latest_cost(p_branch_id uuid,p_from timestamptz,p_to timestamptz)
RETURNS TABLE(raw_material_id uuid,raw_material_name text,raw_material_code text,unit_name text,
 consumed_quantity numeric,actual_quantity numeric,estimated_quantity numeric,actual_cost numeric,
 estimated_cost numeric,displayed_cost numeric,pricing_basis text,price_missing boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
 IF NOT(public.can_permission('reports.costing') OR public.can_permission('shifts.report.shift') OR public.can_permission('shifts.day_close')) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
 RETURN QUERY
 WITH quantities AS MATERIALIZED (
  SELECT il.raw_material_id,round(sum(abs(il.quantity)),6)::numeric qty
  FROM public.inventory_ledger il
  WHERE il.branch_id=p_branch_id AND il.raw_material_id IS NOT NULL AND il.quantity<0
   AND il.created_at>=p_from AND il.created_at<=p_to
   AND il.entry_type IN('sale','kitchen_send') AND COALESCE(il.reference_type,'') IN('sale','kitchen_send')
   AND private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at)
  GROUP BY il.raw_material_id
 ), prices AS MATERIALIZED (
  SELECT cp.* FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT q.raw_material_id FROM quantities q)) cp
 )
 SELECT rm.id,rm.name::text,rm.code::text,COALESCE(mu.symbol,mu.code,mu.name,'')::text,
  q.qty,q.qty,0::numeric,COALESCE(round(q.qty*cp.unit_cost,2),0)::numeric,0::numeric,
  COALESCE(round(q.qty*cp.unit_cost,2),0)::numeric,'latest_approved'::text,cp.unit_cost IS NULL
 FROM quantities q JOIN public.raw_materials rm ON rm.id=q.raw_material_id
 LEFT JOIN public.measurement_units mu ON mu.id=rm.unit_id
 LEFT JOIN prices cp ON cp.raw_material_id=q.raw_material_id AND cp.branch_id=p_branch_id
 ORDER BY rm.name,rm.id;
END $$;
REVOKE ALL ON FUNCTION public.get_raw_consumption_latest_cost(uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_raw_consumption_latest_cost(uuid,timestamptz,timestamptz) TO authenticated;

-- Split future Smouha reports only. Same legacy standard-text jobs; no agent
-- protocol changes. Exact source slices concatenate back to the normalized text.
CREATE FUNCTION public.split_legacy_report_text(p_text text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE remaining text:=replace(replace(COALESCE(p_text,''),E'\r\n',E'\n'),E'\r',E'\n');
 chunk text; n integer; line_n integer; i integer; chunks text[]:='{}';
BEGIN
 WHILE length(remaining)>0 LOOP
  n:=LEAST(320,length(remaining)); chunk:=left(remaining,n); line_n:=0;
  FOR i IN 1..length(chunk) LOOP
   IF substr(chunk,i,1)=E'\n' THEN line_n:=line_n+1; IF line_n=12 THEN n:=i; EXIT; END IF; END IF;
  END LOOP;
  -- Prefer complete source lines but preserve long lines by character slices.
  IF n=320 AND strpos(chunk,E'\n')>0 THEN
   n:=length(chunk)-strpos(reverse(chunk),E'\n')+1;
  END IF;
  chunks:=array_append(chunks,left(remaining,n)); remaining:=substr(remaining,n+1);
  IF cardinality(chunks)>128 THEN RAISE EXCEPTION 'REPORT_TOO_LARGE_USE_A4'; END IF;
 END LOOP;
 RETURN CASE WHEN cardinality(chunks)=0 THEN ARRAY[''] ELSE chunks END;
END $$;
REVOKE ALL ON FUNCTION public.split_legacy_report_text(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.split_legacy_report_text(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_cloud_report_print(p_branch_id uuid,p_payload jsonb,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job public.cloud_print_jobs%ROWTYPE; v_first public.cloud_print_jobs%ROWTYPE;
 v_payload jsonb; v_parts text[]; v_i integer; v_key text; v_ids jsonb:='[]';
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
 IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH'); END IF;
 IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.report.shift') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.report.shift'); END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD'); END IF;
 IF COALESCE(btrim(p_idempotency_key),'')='' THEN RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_KEY_REQUIRED'); END IF;
 v_key:=btrim(p_idempotency_key);
 -- Serialize duplicate report submissions before checking the root job. A report
 -- accepted before this migration is returned unchanged, never expanded/replayed.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_branch_id::text||':report:'||v_key,0));
 SELECT * INTO v_first FROM public.cloud_print_jobs WHERE branch_id=p_branch_id AND idempotency_key=v_key;
 IF v_first.id IS NOT NULL THEN RETURN jsonb_build_object('success',true,'job_id',v_first.id,'status',v_first.status,'station_code',v_first.station_code,'deduplicated',true); END IF;
 v_payload:=public._normalize_thermal_print_payload(p_payload);
 IF p_branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'::uuid THEN
  v_parts:=public.split_legacy_report_text(v_payload->>'text');
 ELSE v_parts:=ARRAY[v_payload->>'text']; END IF;
 FOR v_i IN 1..cardinality(v_parts) LOOP
  INSERT INTO public.cloud_print_jobs(branch_id,requested_by,kind,station_code,payload,idempotency_key,created_at)
  VALUES(p_branch_id,auth.uid(),'report','cashier',
   CASE WHEN cardinality(v_parts)>1 THEN
    (v_payload-'template')||jsonb_build_object('text','Z ['||v_i||'/'||cardinality(v_parts)||']'||E'\n'||v_parts[v_i],
      'report_page',v_i,'report_pages',cardinality(v_parts)) ELSE v_payload END,
   CASE WHEN v_i=1 THEN v_key ELSE v_key||':page:'||v_i END,
   transaction_timestamp()+(v_i-1)*interval '1 microsecond') RETURNING * INTO v_job;
  IF v_i=1 THEN v_first:=v_job; END IF;
  v_ids:=v_ids||jsonb_build_array(v_job.id);
 END LOOP;
 RETURN jsonb_build_object('success',true,'job_id',v_first.id,'status',v_first.status,'station_code','cashier','job_ids',v_ids,'pages',cardinality(v_parts));
END $$;
REVOKE ALL ON FUNCTION public.enqueue_cloud_report_print(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_report_print(uuid,jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';

-- Current operational stock value reads compact balances, never FIFO layers or
-- inventory-ledger price history. Preserve the existing report permission scope.
CREATE FUNCTION public.get_raw_material_latest_valuation(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE(raw_material_id uuid,raw_material_name text,raw_material_code text,branch_id uuid,
 latest_cost numeric,previous_cost numeric,change_amount numeric,change_pct numeric,price_source text,
 priced_at timestamptz,reference_number text,source_detail text,event_count bigint,stock_quantity numeric,
 positive_quantity numeric,negative_quantity numeric,actual_stock_value numeric,estimated_negative_value numeric,
 unpriced_negative_quantity numeric,estimated_net_stock_value numeric,price_missing boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT public.can_permission('reports.costing') THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
 IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
 RETURN QUERY
 WITH materials AS MATERIALIZED (
  SELECT rm.id,rm.name,rm.code,rm.branch_id,COALESCE(ri.quantity,0)::numeric qty
  FROM public.raw_materials rm LEFT JOIN public.raw_material_inventory ri ON ri.raw_material_id=rm.id AND ri.branch_id=rm.branch_id
  WHERE (p_branch_id IS NULL OR rm.branch_id=p_branch_id) AND public.user_may_access_branch(rm.branch_id)
 ), prices AS MATERIALIZED (
  SELECT cp.* FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT m.id FROM materials m)) cp
 )
 SELECT m.id,m.name::text,m.code::text,m.branch_id,COALESCE(cp.unit_cost,0),NULL::numeric,NULL::numeric,NULL::numeric,
  COALESCE(cp.price_source,'unpriced')::text,cp.priced_at,cp.reference_number,'latest_approved'::text,0::bigint,m.qty,
  greatest(m.qty,0),greatest(-m.qty,0),COALESCE(round(greatest(m.qty,0)*cp.unit_cost,2),0),
  COALESCE(round(greatest(-m.qty,0)*cp.unit_cost,2),0),CASE WHEN cp.unit_cost IS NULL THEN greatest(-m.qty,0) ELSE 0 END,
  COALESCE(round(m.qty*cp.unit_cost,2),0),cp.unit_cost IS NULL
 FROM materials m LEFT JOIN prices cp ON cp.raw_material_id=m.id AND cp.branch_id=m.branch_id ORDER BY m.name,m.id;
END $$;
REVOKE ALL ON FUNCTION public.get_raw_material_latest_valuation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_latest_valuation(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
