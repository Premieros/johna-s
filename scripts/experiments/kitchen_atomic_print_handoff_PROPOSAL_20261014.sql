
-- STAGED / REVIEW ONLY. NEVER APPLY TO PRODUCTION AUTOMATICALLY.
-- Test only in rollback-only local CI. Requires independent production approval.
-- Transactional print-handoff candidate: authoritative kitchen delta -> durable
-- cloud print job in the SAME transaction; no Windows or client API change.
-- Existing kitchen identity: kitchen:<station>:<sorted send_id:current_quantity>.
-- The opt-in RPC catches queue insertion failure and falls back to the
-- existing browser dispatch without rolling back a successful kitchen send.
-- No implicit replay of historic or ambiguous orders.
-- Emergency remote stop for the opt-in RPC. This lives in an unexposed
-- schema and starts DISABLED for every branch, even if a frontend is flagged on.
-- A rollout row must be explicitly enabled with a short expiry (e.g. 5 min).
-- Stop an active pilot with a single admin UPDATE enabled=false, expires_at=now().
-- No grants to clients, no writes to kitchen/inventory/accounting records.
CREATE TABLE IF NOT EXISTS private.kitchen_print_handoff_rollout (
  branch_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.kitchen_print_handoff_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.kitchen_print_handoff_rollout
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private._enqueue_kitchen_sent_delta(
  p_branch_id uuid, p_order_id uuid, p_actor_id uuid, p_send jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $atomic_print$
DECLARE
  v_station text;
  v_group jsonb;
  v_order public.orders%ROWTYPE;
  v_key text;
  v_text text;
  v_item_text text;
  v_template_items jsonb;
  v_meta jsonb;
  v_ticket jsonb;
  v_count integer := 0;
  v_stamp text;
  v_order_type_label text;
BEGIN
  IF p_order_id IS NULL OR p_branch_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_PRINT_MISSING_CONTEXT';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id;
  IF NOT FOUND OR v_order.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'KITCHEN_PRINT_ORDER_BRANCH_MISMATCH';
  END IF;
  IF COALESCE((p_send->>'success')::boolean,false) IS NOT TRUE
     OR COALESCE((p_send->>'items_sent_count')::integer,0) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(p_send->'sent') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_send->'sent') = 0 THEN
    RAISE EXCEPTION 'KITCHEN_PRINT_MISSING_SENT_DELTA';
  END IF;
  -- Never silently drop a confirmed kitchen delta that has no printer station.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_send->'sent') item
    WHERE NULLIF(btrim(COALESCE(item->>'station_code','')),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'KITCHEN_PRINT_STATION_MISSING';
  END IF;
  v_stamp := to_char(timezone('Africa/Cairo', now()), 'YYYY-MM-DD HH24:MI');
  v_order_type_label := CASE lower(regexp_replace(btrim(COALESCE(p_send->>'order_type','')), '[ -]+', '_', 'g'))
    WHEN 'dine_in' THEN 'داخل الصالة'
    WHEN 'takeaway' THEN 'تيك أواي'
    WHEN 'take_away' THEN 'تيك أواي'
    WHEN 'drive_thru' THEN 'درايف ثرو'
    WHEN 'delivery' THEN 'توصيل'
    WHEN 'quick_order' THEN 'طلب سريع'
    ELSE NULLIF(btrim(COALESCE(p_send->>'order_type','')),'')
  END;

  FOR v_station, v_group IN
    SELECT btrim(item->>'station_code') AS station,
           jsonb_agg(item ORDER BY ord) AS group_items
    FROM jsonb_array_elements(p_send->'sent') WITH ORDINALITY AS i(item,ord)
    WHERE NULLIF(btrim(COALESCE(item->>'station_code','')),'') IS NOT NULL
    GROUP BY btrim(item->>'station_code')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.kitchen_stations ks
      WHERE ks.branch_id = p_branch_id
        AND lower(btrim(ks.code)) = lower(v_station)
        AND ks.is_active
    ) THEN
      RAISE EXCEPTION 'KITCHEN_PRINT_STATION_BRANCH_OR_ACTIVE_MISMATCH';
    END IF;
    -- The number before ':' must match the browser Number(current_quantity)
    -- formatting, not raw NUMERIC(14,4) scale.
    SELECT string_agg(
      NULLIF(item->>'send_id','') || ':' ||
      (((item->>'current_quantity')::numeric)::double precision)::text,
      ',' ORDER BY
      NULLIF(item->>'send_id','') || ':' ||
      (((item->>'current_quantity')::numeric)::double precision)::text
    )
    INTO v_key
    FROM jsonb_array_elements(v_group) item;
    IF v_key IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_group) item
      WHERE NULLIF(item->>'send_id','') IS NULL
         OR NULLIF(item->>'current_quantity','') IS NULL
         OR NULLIF(item->>'quantity','') IS NULL
    ) THEN
      RAISE EXCEPTION 'KITCHEN_PRINT_DELTA_IDENTITY_MISSING';
    END IF;
    v_key := 'kitchen:' || v_station || ':' || v_key;

    SELECT COALESCE(string_agg(
      ((item->>'quantity')::numeric::double precision)::text ||
      ' x ' || COALESCE(NULLIF(item->>'product_name',''),'—') ||
      COALESCE(
        (SELECT E'\r\n' || string_agg(
           '+ ' || COALESCE(NULLIF(m->>'option_name',''),m->>'option_name_en'),
           E'\r\n')
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(item->'modifiers')='array'
             THEN item->'modifiers' ELSE '[]'::jsonb END
         ) m
         WHERE COALESCE(NULLIF(m->>'option_name',''),m->>'option_name_en') IS NOT NULL),
        ''
      ) ||
      CASE WHEN NULLIF(btrim(COALESCE(item->>'notes','')),'') IS NOT NULL
        THEN E'\r\nملاحظة: ' || btrim(item->>'notes') ELSE '' END,
      E'\r\n' ORDER BY ord),''), COALESCE(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'qty', ((item->>'quantity')::numeric::double precision)::text,
        'name', COALESCE(NULLIF(item->>'product_name',''),'—'),
        'notes', NULLIF(btrim(COALESCE(item->>'notes','')),''),
        'modifiers', COALESCE((
          SELECT jsonb_agg(COALESCE(NULLIF(m->>'option_name',''),m->>'option_name_en'))
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(item->'modifiers')='array'
              THEN item->'modifiers' ELSE '[]'::jsonb END
          ) m
          WHERE COALESCE(NULLIF(m->>'option_name',''),m->>'option_name_en') IS NOT NULL
        ),'[]'::jsonb)
      )) ORDER BY ord
    ),'[]'::jsonb)
    INTO v_item_text, v_template_items
    FROM jsonb_array_elements(v_group) WITH ORDINALITY AS i(item,ord);

    v_text := concat_ws(E'\r\n',
      'تذكرة المطبخ','المحطة',v_station,repeat('-',32),
      'الطلب: ' || COALESCE(NULLIF(p_send->>'order_number',''),p_order_id::text),
      CASE WHEN NULLIF(p_send->>'table_name','') IS NOT NULL
        THEN 'الطاولة: ' || (p_send->>'table_name') END,
      CASE WHEN NULLIF(p_send->>'order_type','') IS NOT NULL
        THEN 'النوع: ' || v_order_type_label END,
      'الوقت: ' || to_char(timezone('Africa/Cairo',now()),'HH24:MI'),
      CASE WHEN NULLIF(p_send->>'guest_count','') IS NOT NULL
        THEN 'الأفراد: ' || (p_send->>'guest_count') END,
      repeat('-',32),'الأصناف',v_item_text,repeat('-',32),'');

    v_meta := jsonb_build_array(
      jsonb_build_object('label','رقم الطلب','value',
        COALESCE(NULLIF(p_send->>'order_number',''),p_order_id::text),'emphasis',true),
      jsonb_build_object('label','التاريخ','value',v_stamp),
      jsonb_build_object('label','النوع','value',COALESCE(v_order_type_label,'—'))
    );
    IF NULLIF(p_send->>'table_name','') IS NOT NULL THEN
      v_meta := v_meta || jsonb_build_array(
        jsonb_build_object('label','الطاولة','value',p_send->>'table_name','emphasis',true)
      );
    END IF;
    IF NULLIF(p_send->>'guest_count','') IS NOT NULL THEN
      v_meta := v_meta || jsonb_build_array(
        jsonb_build_object('label','عدد الأفراد','value',p_send->>'guest_count')
      );
    END IF;

    v_ticket := jsonb_build_object(
      'order_id',p_order_id,'text',v_text,'paperWidthMm',80,'copies',1,
      'template',jsonb_build_object(
        'version',1,'kind','kitchen','isAr',true,'paperWidthMm',80,
        'storeName','JOHNA''S','storeSubtitle','RESTAURANT',
        'title','تذكرة المطبخ','subtitle','نسخة المطبخ',
        'station',v_station,'meta',v_meta,'itemsHeading','الأصناف',
        'items',v_template_items,
        'footerLines',jsonb_build_array('نهاية الطلب')
      )
    );
    INSERT INTO public.cloud_print_jobs (
      branch_id,requested_by,kind,station_code,payload,idempotency_key
    ) VALUES (p_branch_id,p_actor_id,'kitchen',v_station,v_ticket,v_key)
    ON CONFLICT (branch_id,idempotency_key) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$atomic_print$;

-- The private schema grants authenticated USAGE in this project. Explicitly
-- remove default PUBLIC EXECUTE: only the postgres-owned SECURITY DEFINER
-- kitchen wrapper may invoke this helper, never an arbitrary user payload.
REVOKE ALL ON FUNCTION private._enqueue_kitchen_sent_delta(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- NEW OPT-IN RPC ONLY. The existing public.send_to_kitchen(uuid,uuid) is
-- intentionally NEVER replaced. Old clients and inventory behavior do not change.
-- The opt-in client passes the actual UI language. Because the approved SQL
-- formatter currently matches Arabic only, English retains client-only
-- dispatch rather than receiving an incorrectly translated kitchen ticket.
CREATE OR REPLACE FUNCTION public.send_to_kitchen_with_print(
  p_order_id uuid, p_sent_by uuid, p_is_ar boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $optional_handoff$
DECLARE
  v_result jsonb;
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF p_is_ar IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','PRINT_LANGUAGE_REQUIRED');
  END IF;
  -- The existing canonical function owns all permissions, branch, price,
  -- warehouse, inventory, FIFO, cancellation and served-order invariants.
  v_result := public.send_to_kitchen(p_order_id,p_sent_by);
  IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;
  IF COALESCE((v_result->>'items_sent_count')::integer,0) = 0 THEN
    RETURN v_result || jsonb_build_object('print_queue_state','not_needed');
  END IF;
  IF NOT p_is_ar THEN
    RETURN v_result || jsonb_build_object(
      'print_queue_state','client_only','print_queue_warning','ENGLISH_TICKET_USE_EXISTING_CLIENT'
    );
  END IF;
  -- Isolate the optional queue insert in its own PL/pgSQL subtransaction.
  -- A queue error MUST NOT roll back the successful kitchen send/stock effects.
  -- Remote stop is evaluated AFTER the canonical send; if disabled/expired,
  -- the existing client will enqueue that SAME delta through the legacy path.
  -- No queue helper or additional printer operation is performed here.
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM private.kitchen_print_handoff_rollout rollout
      WHERE rollout.branch_id = (v_result->>'branch_id')::uuid
        AND rollout.enabled IS TRUE
        AND rollout.expires_at > clock_timestamp()
    ) THEN
      RETURN v_result || jsonb_build_object(
        'print_queue_state','client_fallback',
        'print_queue_warning','SERVER_KITCHEN_PRINT_HANDOFF_DISABLED'
      );
    END IF;
    v_count := private._enqueue_kitchen_sent_delta(
      (v_result->>'branch_id')::uuid,p_order_id,v_uid,v_result
    );
    RETURN v_result || jsonb_build_object(
      'print_queue_state','queued','print_queue_jobs',v_count
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN v_result || jsonb_build_object(
      'print_queue_state','client_fallback',
      'print_queue_warning','DURABLE_KITCHEN_PRINT_ENQUEUE_FAILED'
    );
  END;
END;
$optional_handoff$;
REVOKE ALL ON FUNCTION public.send_to_kitchen_with_print(uuid,uuid,boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen_with_print(uuid,uuid,boolean)
  TO authenticated;
