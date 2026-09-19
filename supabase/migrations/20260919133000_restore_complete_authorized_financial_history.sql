-- Restore complete authorized financial history without weakening branch isolation.
--
-- The previous deterministic sampling intentionally hid older financial rows from
-- non-owner users. That makes operational reports numerically incomplete. Keep
-- all existing RESTRICTIVE policies in place, but make their shared predicates
-- branch-authoritative instead of sampling historical rows.
--
-- This migration does not touch POS, shifts, day-close, kitchen, print queues,
-- printer stations, or the Windows Print Agent.

CREATE OR REPLACE FUNCTION private.financial_row_visible(
  p_row_id uuid,
  p_branch_id uuid,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_row_id IS NULL OR p_branch_id IS NULL OR p_created_at IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;

  RETURN public.user_may_access_branch(p_branch_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.sale_read_visible(
  p_sale_id uuid,
  p_branch_id uuid,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_sale_id IS NULL OR p_branch_id IS NULL OR p_created_at IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;

  RETURN public.user_may_access_branch(p_branch_id);
END;
$$;

REVOKE ALL ON FUNCTION private.financial_row_visible(uuid, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.sale_read_visible(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.financial_row_visible(uuid, uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sale_read_visible(uuid, uuid, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION private.financial_row_visible(uuid, uuid, timestamptz)
  IS 'Complete branch-scoped financial history predicate. No historical sampling; existing table permissions and branch RLS remain authoritative.';

COMMENT ON FUNCTION private.sale_read_visible(uuid, uuid, timestamptz)
  IS 'Complete branch-scoped sale history predicate. No historical sampling; existing sales permissions and branch RLS remain authoritative.';
