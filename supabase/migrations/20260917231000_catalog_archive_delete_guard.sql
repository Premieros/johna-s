-- Compatibility guard for existing clients that still issue direct DELETE.
-- The RPCs remain the canonical path; these triggers ensure legacy clients
-- cannot bypass history preservation while the UI is migrated incrementally.

ALTER FUNCTION public.archive_raw_material(uuid) RENAME TO _archive_raw_material_core;
ALTER FUNCTION public.archive_product(uuid) RENAME TO _archive_product_core;

CREATE OR REPLACE FUNCTION public.archive_raw_material(p_raw_material_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('app.catalog_archive_internal', 'on', true);
  v_result := public._archive_raw_material_core(p_raw_material_id);
  PERFORM set_config('app.catalog_archive_internal', 'off', true);
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.catalog_archive_internal', 'off', true);
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_product(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('app.catalog_archive_internal', 'on', true);
  v_result := public._archive_product_core(p_product_id);
  PERFORM set_config('app.catalog_archive_internal', 'off', true);
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.catalog_archive_internal', 'off', true);
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_raw_material_delete_with_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF current_setting('app.catalog_archive_internal', true) = 'on' THEN
    RETURN OLD;
  END IF;

  v_result := public.archive_raw_material(OLD.id);
  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'RAW_MATERIAL_ARCHIVE_FAILED: %', COALESCE(v_result->>'error', 'UNKNOWN');
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_product_delete_with_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF current_setting('app.catalog_archive_internal', true) = 'on' THEN
    RETURN OLD;
  END IF;

  v_result := public.archive_product(OLD.id);
  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'PRODUCT_ARCHIVE_FAILED: %', COALESCE(v_result->>'error', 'UNKNOWN');
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_raw_material_history_safe_delete ON public.raw_materials;
CREATE TRIGGER trg_raw_material_history_safe_delete
BEFORE DELETE ON public.raw_materials
FOR EACH ROW EXECUTE FUNCTION public.guard_raw_material_delete_with_archive();

DROP TRIGGER IF EXISTS trg_product_history_safe_delete ON public.products;
CREATE TRIGGER trg_product_history_safe_delete
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.guard_product_delete_with_archive();

-- Historical recipe versions are immutable. "Delete" of the current recipe
-- means deactivate it; old versions and their items can never be physically
-- removed through the normal recipe UI/RPC.
CREATE OR REPLACE FUNCTION public.delete_recipe_controlled(p_recipe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_recipe public.recipes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('recipes.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'recipes.manage');
  END IF;

  SELECT * INTO v_recipe FROM public.recipes WHERE id = p_recipe_id FOR UPDATE;
  IF v_recipe.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECIPE_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_recipe.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT v_recipe.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'HISTORICAL_RECIPE_IMMUTABLE');
  END IF;

  UPDATE public.recipes SET is_active = false, updated_at = now() WHERE id = v_recipe.id;
  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(), 'RECIPE_ARCHIVED', 'recipe', v_recipe.id,
    jsonb_build_object('product_id', v_recipe.product_id, 'version', v_recipe.version, 'preserved_items', true),
    v_recipe.branch_id
  );
  RETURN jsonb_build_object('success', true, 'recipe_id', v_recipe.id, 'mode', 'archived');
END;
$function$;

REVOKE ALL ON FUNCTION public._archive_raw_material_core(uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public._archive_product_core(uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.archive_raw_material(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_raw_material(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_product(uuid) TO authenticated;
