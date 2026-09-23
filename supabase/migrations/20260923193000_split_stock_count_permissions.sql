-- Split stock-count approval into independent action permissions.
-- Safe compatibility rule:
--   existing roles with inventory.count.approve keep their current effective behavior
--   by receiving inventory.count.reject + inventory.count.apply.
-- No Production execution is performed by this commit; deployment remains gated separately.

BEGIN;

UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb)
  || '["inventory.count.reject","inventory.count.apply"]'::jsonb
WHERE COALESCE(permissions, '[]'::jsonb) ? 'inventory.count.approve';

DO $$
DECLARE
  v_def text;
BEGIN
  -- reject_stock_count(uuid,text) -> inventory.count.reject
  SELECT pg_get_functiondef('public.reject_stock_count(uuid,text)'::regprocedure)
    INTO v_def;

  IF position('inventory.count.approve' IN v_def) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PERMISSION_GATE_NOT_FOUND:reject_stock_count';
  END IF;

  v_def := replace(v_def, 'inventory.count.approve', 'inventory.count.reject');
  EXECUTE v_def;

  -- apply_stock_count(uuid) -> inventory.count.apply
  SELECT pg_get_functiondef('public.apply_stock_count(uuid)'::regprocedure)
    INTO v_def;

  IF position('inventory.count.approve' IN v_def) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PERMISSION_GATE_NOT_FOUND:apply_stock_count';
  END IF;

  v_def := replace(v_def, 'inventory.count.approve', 'inventory.count.apply');
  EXECUTE v_def;

  -- The unified operational approval path used the former bundled permission
  -- for both approve and reject. Preserve the path, but make its decision gate
  -- depend on the requested action. The called RPC remains authoritative too.
  SELECT pg_get_functiondef('public.decide_operational_approval(text,uuid,boolean,text)'::regprocedure)
    INTO v_def;

  IF position('inventory.count.approve' IN v_def) > 0 THEN
    v_def := replace(
      v_def,
      'public.can_permission(''inventory.count.approve'')',
      '(CASE WHEN p_approve THEN public.can_permission(''inventory.count.approve'') ELSE public.can_permission(''inventory.count.reject'') END)'
    );
    v_def := replace(
      v_def,
      'can_permission(''inventory.count.approve'')',
      '(CASE WHEN p_approve THEN public.can_permission(''inventory.count.approve'') ELSE public.can_permission(''inventory.count.reject'') END)'
    );
    EXECUTE v_def;
  END IF;
END;
$$;

COMMIT;
