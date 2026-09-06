-- P0-B: protect branch feature overrides from tenant/branch mismatch and harden search_path.

CREATE OR REPLACE FUNCTION public.super_admin_set_branch_override(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_feature_key text,
  p_enabled boolean,
  p_limit_value integer DEFAULT NULL::integer,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_feat_id uuid;
  v_branch_tenant uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT b.organization_id
  INTO v_branch_tenant
  FROM public.branches b
  WHERE b.id = p_branch_id;

  IF v_branch_tenant IS NULL OR v_branch_tenant IS DISTINCT FROM p_tenant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_TENANT_MISMATCH');
  END IF;

  SELECT f.id
  INTO v_feat_id
  FROM public.features f
  WHERE f.key = p_feature_key;

  IF v_feat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'FEATURE_NOT_FOUND');
  END IF;

  INSERT INTO public.branch_feature_overrides (
    tenant_id,
    branch_id,
    feature_id,
    enabled,
    limit_value,
    reason,
    created_by,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_branch_id,
    v_feat_id,
    p_enabled,
    p_limit_value,
    p_reason,
    auth.uid(),
    now()
  )
  ON CONFLICT (branch_id, feature_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      limit_value = EXCLUDED.limit_value,
      reason = EXCLUDED.reason,
      updated_at = now();

  INSERT INTO public.subscription_events (
    tenant_id,
    event_type,
    metadata,
    created_by
  )
  VALUES (
    p_tenant_id,
    CASE WHEN p_enabled THEN 'feature_enabled' ELSE 'feature_disabled' END,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'feature_key', p_feature_key,
      'enabled', p_enabled,
      'reason', p_reason
    ),
    auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.super_admin_set_branch_override(uuid, uuid, text, boolean, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_set_branch_override(uuid, uuid, text, boolean, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_set_branch_override(uuid, uuid, text, boolean, integer, text) TO authenticated;
