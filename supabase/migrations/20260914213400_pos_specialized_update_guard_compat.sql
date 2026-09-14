-- Allow branch-scoped order UPDATEs to reach the existing specialized guards.
--
-- Security model:
--   * RLS continues to enforce branch isolation for every authenticated UPDATE.
--   * guard_pos_operator_ownership() remains authoritative for general POS/order
--     mutations and blocks non-owners unless they have the explicit manager bundle.
--   * dedicated KDS and receipt-print guards remain authoritative for their own
--     fields and permissions. Keeping those permission checks in RLS would turn a
--     denied UPDATE into a silent zero-row result before the dedicated guard can
--     return its established PERMISSION_DENIED contract.
--
-- This migration does not change printing, KDS, inventory, kitchen-send, payment,
-- or pricing logic.

DROP POLICY IF EXISTS auth_update_orders ON public.orders;

CREATE POLICY auth_update_orders ON public.orders
FOR UPDATE TO authenticated
USING (
  public.user_may_access_branch(branch_id)
)
WITH CHECK (
  public.user_may_access_branch(branch_id)
);
