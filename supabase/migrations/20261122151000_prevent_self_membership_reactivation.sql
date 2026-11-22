-- Existing organization-membership guard tightened to make the account's own
-- membership lifecycle immutable to non-admins. This prevents deactivated users
-- from setting is_active=true on their own membership and prevents rewriting audit IDs.
-- Administrator and trusted service roles retain their pre-existing exceptions.
CREATE OR REPLACE FUNCTION private.guard_organization_membership_binding()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF public.is_pos_admin() OR coalesce(current_setting('role',true),'none') IN ('none','postgres','service_role') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id
   OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.membership_role IS DISTINCT FROM OLD.membership_role
   OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at
   OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
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
$function$
;
