-- Coordinated rollback: first restore the prior frontend release, then remove
-- new approval/revision endpoints. Never changes inventory or existing transfers.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$
BEGIN
  IF to_regprocedure('public.approve_previewed_warehouse_transfer(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.revise_pending_warehouse_transfer(uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_PREVIEW_ROLLBACK_SOURCE_DRIFT';
  END IF;
END;
$guard$;
DROP FUNCTION public.approve_previewed_warehouse_transfer(uuid,jsonb);
DROP FUNCTION public.revise_pending_warehouse_transfer(uuid,jsonb,jsonb);
COMMIT;
