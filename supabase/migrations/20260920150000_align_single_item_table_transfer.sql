-- Align the legacy single-item table-transfer RPC with the authoritative
-- multi-item implementation introduced on 2026-09-20.
--
-- This keeps compatibility for older clients while ensuring one permission,
-- sent-item, KDS, inventory, discount and tax path for all item transfers.
-- No printing/queue routing behavior is changed.

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
BEGIN
  v_result := public.transfer_order_items_to_table(
    p_order_id,
    ARRAY[p_order_item_id]::uuid[],
    p_target_table_id
  );

  IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  -- Preserve the useful legacy response fields for older installed clients.
  -- The canonical move keeps the same order_item id instead of delete/reinsert.
  RETURN v_result || jsonb_build_object(
    'new_order_item_id', p_order_item_id,
    'kds_changed', COALESCE((v_result->>'kds_reassigned')::boolean,false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_order_item_to_table(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_item_to_table(uuid,uuid,uuid) TO authenticated, service_role;

NOTIFY pgrst,'reload schema';
