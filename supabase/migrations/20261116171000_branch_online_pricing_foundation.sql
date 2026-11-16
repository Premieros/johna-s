-- Branch-local online order markup, disabled by default in every branch.
-- No product price, historical order, tax, stock or ledger backfill.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

CREATE TABLE public.branch_online_pricing (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  markup_percent numeric(6,2) NOT NULL DEFAULT 26.00
    CHECK (markup_percent BETWEEN 0 AND 100),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.branch_online_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_online_pricing_read ON public.branch_online_pricing
  FOR SELECT TO authenticated
  USING (public.is_pos_admin() OR public.user_may_access_branch(branch_id));
REVOKE ALL ON public.branch_online_pricing FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.branch_online_pricing TO authenticated;

CREATE FUNCTION public.set_branch_online_pricing(
  p_branch_id uuid, p_enabled boolean, p_markup_percent numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_enabled IS NULL OR p_markup_percent IS NULL
     OR p_markup_percent<0 OR p_markup_percent>100 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_ONLINE_PRICING');
  END IF;
  INSERT INTO public.branch_online_pricing (branch_id,enabled,markup_percent,updated_by,updated_at)
  VALUES (p_branch_id,p_enabled,p_markup_percent,auth.uid(),now())
  ON CONFLICT (branch_id)
  DO UPDATE SET enabled=EXCLUDED.enabled,
    markup_percent=EXCLUDED.markup_percent,
    updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
  RETURN jsonb_build_object('success',true,'branch_id',p_branch_id,
    'enabled',p_enabled,'markup_percent',p_markup_percent);
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_branch_online_pricing(uuid,boolean,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_branch_online_pricing(uuid,boolean,numeric)
  TO authenticated,service_role;

-- Called only by authoritative POS writers. Add markup after modifier delta,
-- before line discount and before the unchanged branch tax calculation.
CREATE FUNCTION public._online_order_price(
  p_branch_id uuid,p_order_type text,p_price numeric
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,pg_temp
AS $fn$
DECLARE v_pct numeric;
BEGIN
  IF p_order_type IS DISTINCT FROM 'online' THEN
    RETURN round(GREATEST(COALESCE(p_price,0),0),2);
  END IF;
  SELECT markup_percent INTO v_pct
  FROM public.branch_online_pricing
  WHERE branch_id=p_branch_id AND enabled=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'ONLINE_ORDER_NOT_ENABLED'; END IF;
  RETURN round(GREATEST(COALESCE(p_price,0),0)*(1+v_pct/100),2);
END;
$fn$;
REVOKE ALL ON FUNCTION public._online_order_price(uuid,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._online_order_price(uuid,text,numeric)
  TO authenticated,service_role;

-- Extend the already established per-type permission model. Online is served
-- with the delivery capability until a distinct permission is introduced.
CREATE OR REPLACE FUNCTION public._pos_order_type_allowed(p_type text,p_table_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp AS $fn$
 SELECT COALESCE(
   p_type IN ('dine_in','takeaway','drive_thru','delivery','online')
   AND (p_table_id IS NULL OR p_type='dine_in')
   AND public.can_permission('pos.order.' ||
       CASE WHEN p_type='online' THEN 'delivery' ELSE p_type END),false);
$fn$;

COMMIT;
