BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

-- A separate public onboarding switch; do not change staff-account creation.
UPDATE public.system_settings SET config=jsonb_set(coalesce(config,'{}'::jsonb),'{security}',
 coalesce(config->'security','{}'::jsonb)||'{"allow_tenant_registration":true}'::jsonb)
WHERE id=1;

CREATE OR REPLACE FUNCTION public.get_public_tenant_registration_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('enabled',coalesce((SELECT config#>'{security,allow_tenant_registration}'='true'::jsonb FROM public.system_settings WHERE id=1),false));
$$;
REVOKE ALL ON FUNCTION public.get_public_tenant_registration_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_registration_status() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.set_public_tenant_registration_enabled(p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'INVALID_SETTINGS'; END IF;
 UPDATE public.system_settings SET config=jsonb_set(coalesce(config,'{}'::jsonb),'{security}',
  coalesce(config->'security','{}'::jsonb)||jsonb_build_object('allow_tenant_registration',p_enabled)) WHERE id=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_SETTINGS_MISSING'; END IF;
 INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details)
 SELECT auth.uid(),u.email,'TOGGLE_PUBLIC_TENANT_REGISTRATION','system_settings',NULL,jsonb_build_object('settings_id',1,'enabled',p_enabled)
 FROM public.users u WHERE u.id=auth.uid();
 RETURN jsonb_build_object('success',true,'enabled',p_enabled);
END;
$$;
REVOKE ALL ON FUNCTION public.set_public_tenant_registration_enabled(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_public_tenant_registration_enabled(boolean) TO authenticated;

-- A member cannot move their own membership into another institution, promote
-- themselves, or attach an unrelated user to an institution through REST.
CREATE OR REPLACE FUNCTION private.guard_organization_membership_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF public.is_pos_admin() OR coalesce(current_setting('role',true),'none') IN ('none','postgres','service_role') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id
   OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.membership_role IS DISTINCT FROM OLD.membership_role) THEN
  RAISE EXCEPTION 'MEMBERSHIP_BINDING_IMMUTABLE';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users u JOIN public.branches b ON b.id=u.branch_id
   WHERE u.id=NEW.user_id AND b.organization_id=NEW.organization_id)
 AND NOT EXISTS(SELECT 1 FROM public.user_branch_access a JOIN public.branches b ON b.id=a.branch_id
   WHERE a.user_id=NEW.user_id AND b.organization_id=NEW.organization_id) THEN
  RAISE EXCEPTION 'MEMBERSHIP_BRANCH_MISMATCH';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_organization_membership_binding() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_organization_membership_binding ON public.organization_members;
CREATE TRIGGER guard_organization_membership_binding BEFORE INSERT OR UPDATE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION private.guard_organization_membership_binding();

-- One internal seed implementation shared by authorized branch creation and verified onboarding.
CREATE OR REPLACE FUNCTION private.seed_organization_branch(
  p_organization_id uuid,
  p_name text,
  p_name_en text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_global_tax numeric(5,2);
  v_global_tax_enabled boolean;
  v_global_currency text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF btrim(COALESCE(p_name, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_BRANCH_NAME');
  END IF;

  -- Mark this exact caller + organization BEFORE the branch insert. Branch
  -- AFTER INSERT triggers seed guarded rows immediately, so a branch-id marker
  -- created after INSERT would be too late. This marker is private and is
  -- removed before return; any exception rolls it back with the transaction.
  INSERT INTO public.work_authorization_branch_bootstrap (user_id, organization_id)
  VALUES (auth.uid(), p_organization_id);

  INSERT INTO public.branches (name, name_en, address, phone, is_active, organization_id)
  VALUES (p_name, p_name_en, p_address, p_phone, true, p_organization_id)
  RETURNING id INTO v_branch_id;

  -- Preserve the existing creator access grant after the branch now exists.
  IF EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND is_active) THEN
    INSERT INTO public.user_branch_access(user_id,branch_id) VALUES(auth.uid(),v_branch_id)
    ON CONFLICT(user_id,branch_id) DO NOTHING;
  END IF;

  INSERT INTO public.warehouses (name, branch_id, is_active)
  VALUES (p_name || ' - Main', v_branch_id, true)
  RETURNING id INTO v_warehouse_id;

  SELECT COALESCE(tax_rate, 15), COALESCE(tax_enabled, true), COALESCE(currency, 'EGP')
  INTO v_global_tax, v_global_tax_enabled, v_global_currency
  FROM public.settings
  ORDER BY id
  LIMIT 1;

  INSERT INTO public.branch_settings (branch_id, tax_rate, tax_enabled, currency, low_stock_threshold)
  VALUES (v_branch_id, v_global_tax, v_global_tax_enabled, v_global_currency, 10);

  INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
  VALUES (v_branch_id, 'trial', now(), now() + interval '14 days');


  RETURN jsonb_build_object(
    'success', true,
    'branch_id', v_branch_id,
    'warehouse_id', v_warehouse_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'BRANCH_CREATE_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.seed_organization_branch(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_organization_branch(p_organization_id uuid,p_name text,p_name_en text DEFAULT NULL,p_address text DEFAULT NULL,p_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
 IF NOT public.is_pos_admin() AND (NOT public.can_permission('branches.manage') OR NOT public.user_can_access_organization(p_organization_id)) THEN
  RETURN jsonb_build_object('success',false,'error','FORBIDDEN'); END IF;
 v_result:=private.seed_organization_branch(p_organization_id,p_name,p_name_en,p_address,p_phone);
 DELETE FROM public.work_authorization_branch_bootstrap WHERE user_id=auth.uid() AND organization_id=p_organization_id;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_organization_branch(uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_organization_branch(uuid,text,text,text,text) TO authenticated,service_role;

-- Auth signup/password/email verification are managed by Supabase Auth. This
-- endpoint accepts no email/password, identity, role or existing institution ID.
-- It provisions only the verified caller, once, in a fresh institution.
CREATE OR REPLACE FUNCTION public.complete_own_organization_signup(p_organization_name text,p_owner_name text,p_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_uid uuid:=auth.uid(); v_auth auth.users%ROWTYPE; v_profile public.users%ROWTYPE;
 v_org uuid; v_branch uuid; v_warehouse uuid; v_plan uuid; v_branch_result jsonb;
 v_name text:=btrim(p_organization_name); v_owner text:=btrim(p_owner_name);
 v_prior_register text:=coalesce(current_setting('app.register_branch',true),'off');
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 -- Serialize double clicks/tabs on the existing Auth identity, not a global lock.
 SELECT * INTO v_auth FROM auth.users WHERE id=v_uid FOR UPDATE;
 IF NOT FOUND OR coalesce(v_auth.is_anonymous,false) OR v_auth.email IS NULL
    OR v_auth.email_confirmed_at IS NULL THEN RAISE EXCEPTION 'EMAIL_CONFIRMATION_REQUIRED'; END IF;
 IF nullif(to_jsonb(v_auth)->>'banned_until','')::timestamptz>now() THEN RAISE EXCEPTION 'USER_INACTIVE'; END IF;
 SELECT * INTO v_profile FROM public.users WHERE id=v_uid;
 IF FOUND THEN
  IF v_profile.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'USER_INACTIVE'; END IF;
  SELECT b.organization_id,b.id INTO v_org,v_branch FROM public.branches b
   JOIN public.organization_members m ON m.organization_id=b.organization_id AND m.user_id=v_uid
   WHERE b.id=v_profile.branch_id AND m.is_active AND m.membership_role='owner' AND v_profile.role='owner';
  IF v_org IS NULL THEN RAISE EXCEPTION 'PROFILE_ALREADY_EXISTS'; END IF;
  RETURN jsonb_build_object('success',true,'organization_id',v_org,'branch_id',v_branch,'already_completed',true);
 END IF;
 IF (public.get_public_tenant_registration_status()->>'enabled')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'PUBLIC_REGISTRATION_DISABLED'; END IF;
 IF v_name IS NULL OR length(v_name)<2 OR length(v_name)>120 OR v_name~'[[:cntrl:]]'
    OR v_owner IS NULL OR length(v_owner)<2 OR length(v_owner)>120 OR v_owner~'[[:cntrl:]]'
    OR length(coalesce(p_phone,''))>32 THEN RAISE EXCEPTION 'INVALID_REGISTRATION_DETAILS'; END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE lower(email)=lower(v_auth.email)) THEN RAISE EXCEPTION 'PROFILE_ALREADY_EXISTS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.roles WHERE role='owner' AND is_active) THEN RAISE EXCEPTION 'OWNER_ROLE_UNAVAILABLE'; END IF;
 SELECT id INTO v_plan FROM public.plans WHERE slug='free' AND is_active;
 IF v_plan IS NULL THEN RAISE EXCEPTION 'REGISTRATION_PLAN_UNAVAILABLE'; END IF;
 v_org:=gen_random_uuid();
 INSERT INTO public.organizations(id,name,slug,is_active) VALUES(v_org,v_name,'org-'||replace(v_org::text,'-',''),true);
 -- Seed a fresh branch before its owner profile: users.branch_id is NOT NULL.
 -- The private helper is also used by ordinary authorized branch creation.
 v_branch_result:=private.seed_organization_branch(v_org,v_name,NULL,NULL,nullif(btrim(p_phone),''));
 IF NOT coalesce((v_branch_result->>'success')::boolean,false) THEN RAISE EXCEPTION 'ORGANIZATION_BRANCH_SETUP_FAILED'; END IF;
 v_branch:=(v_branch_result->>'branch_id')::uuid; v_warehouse:=(v_branch_result->>'warehouse_id')::uuid;
 PERFORM set_config('app.register_branch','on',true);
 INSERT INTO public.users(id,email,full_name,role,branch_id,is_active,username,phone)
 VALUES(v_uid,lower(v_auth.email),v_owner,'owner',v_branch,true,'owner_'||substr(replace(v_uid::text,'-',''),1,20),nullif(btrim(p_phone),''));
 INSERT INTO public.organization_members(organization_id,user_id,membership_role,is_active) VALUES(v_org,v_uid,'owner',true);
 PERFORM set_config('app.register_branch',v_prior_register,true);
 -- New institution receipts never inherit another institution's receipt text.
 UPDATE public.branch_settings SET currency='EGP',tax_rate=0,tax_enabled=false,receipt_header=v_name,receipt_footer='',logo_url='' WHERE branch_id=v_branch;
 INSERT INTO public.subscriptions(tenant_id,plan_id,status,trial_started_at,trial_ends_at,current_period_start,current_period_end)
 VALUES(v_org,v_plan,'trialing',now(),now()+interval '14 days',now(),now()+interval '14 days');
 DELETE FROM public.work_authorization_branch_bootstrap WHERE user_id=v_uid AND organization_id=v_org;
 RETURN jsonb_build_object('success',true,'organization_id',v_org,'branch_id',v_branch,'warehouse_id',v_warehouse,'trial_days',14);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.register_branch',v_prior_register,true);
 RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_own_organization_signup(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_own_organization_signup(text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
