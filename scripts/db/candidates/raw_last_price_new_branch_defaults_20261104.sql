-- Installed disabled. Enable only in the final, guarded all-branch cutover step.
-- A brand-new branch has no historical stock/FIFO obligations to reconcile.
CREATE FUNCTION private.raw_last_price_new_branch_default()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL AND coalesce(current_setting('role',true),'') NOT IN('service_role','none') THEN
  RAISE EXCEPTION 'AUTH_REQUIRED';
 END IF;
 INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,activation_note)
 VALUES(NEW.id,'new branch created after global last-price cutover');
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.raw_last_price_new_branch_default() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER raw_last_price_new_branch_default AFTER INSERT ON public.branches
 FOR EACH ROW EXECUTE FUNCTION private.raw_last_price_new_branch_default();
ALTER TABLE public.branches DISABLE TRIGGER raw_last_price_new_branch_default;
