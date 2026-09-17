-- Restore complete branch-scoped purchase visibility.
--
-- Purchase invoice history is operational data and must not be sampled. Keep
-- the policy RESTRICTIVE and preserve branch isolation. Other historical
-- financial datasets (sales, expenses, journals, etc.) keep their existing
-- visibility rules.

CREATE OR REPLACE FUNCTION private.purchase_read_visible_by_id(p_purchase_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT public.user_may_access_branch(p.branch_id)
      FROM public.purchases p
      WHERE p.id = p_purchase_id
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION private.purchase_read_visible_by_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.purchase_read_visible_by_id(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS financial_visibility_purchases ON public.purchases;
CREATE POLICY financial_visibility_purchases
  ON public.purchases
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.user_may_access_branch(branch_id));

COMMENT ON FUNCTION private.purchase_read_visible_by_id(uuid)
  IS 'Branch-scoped purchase read predicate. Purchase history is complete for authorized branches; unrelated financial history sampling remains unchanged.';
