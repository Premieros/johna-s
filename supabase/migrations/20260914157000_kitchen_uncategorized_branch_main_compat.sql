-- Preserve the established behavior for legacy/uncategorized products without
-- restoring the old unrestricted station fallback.
--
-- Categorized products remain strict: their category must point to an active
-- station owned by the order branch. A product with no category may use only the
-- active `main` station owned by that same branch.

DO $patch_send_uncategorized_compat$
DECLARE
  v_oid oid;
  v_def text;
  v_old_guard text := 'WHERE c.id IS NULL OR ks.id IS NULL OR ks.branch_id IS DISTINCT FROM v_branch_id OR lower(btrim(ks.code)) = ''cashier''';
  v_new_guard text := 'WHERE (p.category_id IS NOT NULL AND (c.id IS NULL OR ks.id IS NULL OR ks.branch_id IS DISTINCT FROM v_branch_id OR lower(btrim(ks.code)) = ''cashier'')) OR (p.category_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.kitchen_stations default_ks WHERE default_ks.branch_id = v_branch_id AND lower(btrim(default_ks.code)) = ''main'' AND default_ks.is_active = true))';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = 'send_to_kitchen(uuid,uuid)';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'send_to_kitchen(uuid,uuid) not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position(v_old_guard in v_def) = 0 THEN
    RAISE EXCEPTION 'SEND_TO_KITCHEN_STRICT_GUARD_MARKER_MISSING';
  END IF;

  v_def := replace(v_def, v_old_guard, v_new_guard);

  IF position('''station_code'', ks.code' in v_def) = 0 THEN
    RAISE EXCEPTION 'SEND_TO_KITCHEN_STATION_CODE_MARKER_MISSING';
  END IF;

  v_def := replace(
    v_def,
    '''station_code'', ks.code',
    '''station_code'', CASE WHEN p.category_id IS NULL THEN ''main'' ELSE ks.code END'
  );

  EXECUTE v_def;
END
$patch_send_uncategorized_compat$;
