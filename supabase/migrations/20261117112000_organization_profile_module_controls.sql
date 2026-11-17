-- Explicit organization profile and module overrides; no existing organization
-- is changed. Module defaults remain the current legacy direct-allow behavior.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE public.organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone text,
  address text,
  logo_url text,
  currency text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.organization_settings TO authenticated;
CREATE POLICY organization_settings_read ON public.organization_settings
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.user_can_access_organization(organization_id));

CREATE TABLE public.organization_feature_overrides (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, feature_id)
);
ALTER TABLE public.organization_feature_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_feature_overrides FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.organization_feature_overrides TO authenticated;
CREATE POLICY organization_feature_overrides_read ON public.organization_feature_overrides
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.user_can_access_organization(organization_id));

CREATE FUNCTION public.super_admin_set_organization_profile(
  p_organization_id uuid,
  p_name text,
  p_phone text,
  p_address text,
  p_logo_url text,
  p_currency text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_organization_id IS NULL OR length(trim(COALESCE(p_name,'')))<2 OR length(p_name)>180
      OR length(COALESCE(p_currency,''))>10
      OR length(COALESCE(p_phone,''))>100
      OR length(COALESCE(p_address,''))>1000
      OR length(COALESCE(p_logo_url,''))>2000 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PROFILE');
  END IF;
  UPDATE public.organizations SET name=trim(p_name),updated_at=now()
  WHERE id=p_organization_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NOT_FOUND'); END IF;
  INSERT INTO public.organization_settings (
    organization_id,phone,address,logo_url,currency,updated_by,updated_at
  ) VALUES (
    p_organization_id,NULLIF(trim(p_phone),''),NULLIF(trim(p_address),''),
    NULLIF(trim(p_logo_url),''),NULLIF(trim(p_currency),''),auth.uid(),now()
  ) ON CONFLICT (organization_id) DO UPDATE
  SET phone=EXCLUDED.phone,address=EXCLUDED.address,
    logo_url=EXCLUDED.logo_url,currency=EXCLUDED.currency,
    updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
  PERFORM public.log_audit_action(NULL::uuid,'update_organization_profile',
    'organizations',p_organization_id,jsonb_build_object('organization_id',p_organization_id));
  RETURN jsonb_build_object('success',true);
END;
$fn$;

CREATE FUNCTION public.super_admin_set_organization_module(
  p_organization_id uuid,p_feature_key text,p_enabled boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,pg_temp
AS $fn$
DECLARE v_feature_id uuid; v_system boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_enabled IS NULL OR p_organization_id IS NULL OR NOT EXISTS
    (SELECT 1 FROM public.organizations WHERE id=p_organization_id) THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_ORGANIZATION');
  END IF;
  SELECT id,is_system INTO v_feature_id,v_system
  FROM public.features WHERE key=p_feature_key AND is_active=true;
  IF v_feature_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FEATURE_NOT_FOUND');
  END IF;
  -- Mandatory/core capabilities cannot be disabled by an accidental toggle.
  IF v_system AND NOT p_enabled THEN
    RETURN jsonb_build_object('success',false,'error','SYSTEM_MODULE_LOCKED');
  END IF;
  INSERT INTO public.organization_feature_overrides
    (organization_id,feature_id,enabled,updated_by,updated_at)
  VALUES (p_organization_id,v_feature_id,p_enabled,auth.uid(),now())
  ON CONFLICT (organization_id,feature_id) DO UPDATE
  SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
  PERFORM public.log_audit_action(NULL::uuid,'set_organization_module',
    'organizations',p_organization_id,
    jsonb_build_object('feature_key',p_feature_key,'enabled',p_enabled));
  RETURN jsonb_build_object('success',true);
END;
$fn$;

CREATE FUNCTION public.super_admin_reset_organization_module(
  p_organization_id uuid,p_feature_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  DELETE FROM public.organization_feature_overrides o
  USING public.features f
  WHERE o.organization_id=p_organization_id AND o.feature_id=f.id AND f.key=p_feature_key;
  PERFORM public.log_audit_action(NULL::uuid,'reset_organization_module',
    'organizations',p_organization_id,jsonb_build_object('feature_key',p_feature_key));
  RETURN jsonb_build_object('success',true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.super_admin_set_organization_profile(uuid,text,text,text,text,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.super_admin_set_organization_module(uuid,text,boolean)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.super_admin_reset_organization_module(uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.super_admin_set_organization_profile(uuid,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_set_organization_module(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_reset_organization_module(uuid,text) TO authenticated;

-- Existing resolver currently returns unconditional direct access for all
-- modules. Keep that baseline unless a specific organization module has an
-- explicit disabled override. Do not restore older subscription/plan gating.
DO $patch$
DECLARE v_def text; v_needle text; v_guard text;
BEGIN
  SELECT pg_get_functiondef('public.resolve_feature_access(uuid,uuid,text,uuid)'::regprocedure)
  INTO v_def;
  v_needle:=E'BEGIN\n  RETURN jsonb_build_object(';
  IF position(v_needle in v_def)=0
    OR position('direct_access' in v_def)=0
    OR position('organization_feature_overrides' in v_def)>0 THEN
    RAISE EXCEPTION 'ORGANIZATION_FEATURE_RESOLVER_DRIFT';
  END IF;
  v_guard:=$guard$BEGIN
  IF p_tenant_id IS NOT NULL AND auth.uid() IS NOT NULL
     AND NOT public.is_platform_admin()
     AND NOT public.user_can_access_organization(p_tenant_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.branches b
       WHERE b.id=p_branch_id AND b.organization_id=p_tenant_id
         AND public.user_may_access_branch(b.id)
     ) THEN
    RETURN jsonb_build_object('allowed',false,'reason','ORGANIZATION_ACCESS_DENIED');
  END IF;
  IF NOT public.is_platform_admin() AND p_tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_feature_overrides o
    JOIN public.features f ON f.id=o.feature_id
    WHERE o.organization_id=p_tenant_id AND f.key=p_feature_key
      AND o.enabled=false
  ) THEN
    RETURN jsonb_build_object('allowed',false,'reason','ORGANIZATION_MODULE_DISABLED',
      'source','organization');
  END IF;
  RETURN jsonb_build_object($guard$;
  EXECUTE replace(v_def,v_needle,v_guard);
END;
$patch$;
COMMIT;
