-- Freeze the online markup on each staged order so branch policy changes
-- only affect NEW orders and cannot reprice an unpaid previously staged order.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

ALTER TABLE public.orders
  ADD COLUMN online_markup_percent numeric(6,2)
    CHECK (online_markup_percent IS NULL OR online_markup_percent BETWEEN 0 AND 100);

CREATE FUNCTION public._freeze_online_order_markup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,pg_temp
AS $fn$
DECLARE v_pct numeric;
BEGIN
  IF TG_OP='UPDATE' AND NEW.order_type IS NOT DISTINCT FROM OLD.order_type THEN
    IF NEW.online_markup_percent IS DISTINCT FROM OLD.online_markup_percent THEN
      RAISE EXCEPTION 'ONLINE_MARKUP_IMMUTABLE';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.order_type='online' THEN
    SELECT markup_percent INTO v_pct
    FROM public.branch_online_pricing
    WHERE branch_id=NEW.branch_id AND enabled=true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ONLINE_ORDER_NOT_ENABLED'; END IF;
    NEW.online_markup_percent:=v_pct;
  ELSE
    NEW.online_markup_percent:=NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public._freeze_online_order_markup() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_freeze_online_order_markup
  BEFORE INSERT OR UPDATE OF order_type,online_markup_percent
  ON public.orders FOR EACH ROW
  EXECUTE FUNCTION public._freeze_online_order_markup();

-- New four-argument variant is used by authoritative writers. The original
-- three-argument helper remains for direct, unstaged sale calculations.
CREATE FUNCTION public._online_order_price(
  p_branch_id uuid,p_order_type text,p_price numeric,p_order_id uuid
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,pg_temp
AS $fn$
DECLARE v_pct numeric;
BEGIN
  IF p_order_type IS DISTINCT FROM 'online' THEN
    RETURN GREATEST(COALESCE(p_price,0),0);
  END IF;
  IF p_order_id IS NOT NULL THEN
    SELECT o.online_markup_percent INTO v_pct
    FROM public.orders o
    WHERE o.id=p_order_id
      AND o.branch_id=p_branch_id
      AND o.order_type='online';
    IF v_pct IS NULL THEN RAISE EXCEPTION 'ONLINE_ORDER_SNAPSHOT_MISSING'; END IF;
  ELSE
    SELECT markup_percent INTO v_pct
    FROM public.branch_online_pricing
    WHERE branch_id=p_branch_id AND enabled=true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ONLINE_ORDER_NOT_ENABLED'; END IF;
  END IF;
  RETURN ROUND(GREATEST(COALESCE(p_price,0),0)*(1+v_pct/100),2);
END;
$fn$;
REVOKE ALL ON FUNCTION public._online_order_price(uuid,text,numeric,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._online_order_price(uuid,text,numeric,uuid)
  TO authenticated,service_role;
COMMIT;
