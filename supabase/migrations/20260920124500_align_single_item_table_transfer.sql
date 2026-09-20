-- Align the legacy single-item table transfer RPC with the canonical multi-item flow.
-- This keeps older clients working while ensuring sent/unsent lines use one permission,
-- inventory, KDS and ownership contract.
-- No print-agent or print-queue behavior is changed.

CREATE OR REPLACE FUNCTION public.transfer_order_item_to_table(
  p_order_id uuid,
  p_order_item_id uuid,
  p_target_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_kds_changed boolean := false;
BEGIN
  v_result := public.transfer_order_items_to_table(
    p_order_id,
    ARRAY[p_order_item_id]::uuid[],
    p_target_table_id
  );

  IF COALESCE((v_result->>'success')::boolean,false) IS TRUE THEN
    v_kds_changed := COALESCE((v_result->>'kds_reassigned')::boolean,false);
    RETURN v_result || jsonb_build_object(
      'moved_item_id', p_order_item_id,
      'kds_changed', v_kds_changed
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_order_item_to_table(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_item_to_table(uuid,uuid,uuid) TO authenticated, service_role;

NOTIFY pgrst,'reload schema';
