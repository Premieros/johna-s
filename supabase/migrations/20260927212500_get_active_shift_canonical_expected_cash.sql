-- Make live shift expected cash use the same canonical drawer equation as close/report.
-- Production incident: Smouha 2026-09-27 showed 330 EGP before close while
-- close_shift_with_open_orders correctly calculated 15 EGP because a 315 EGP
-- cash purchase was omitted by get_active_shift.
--
-- Scope:
-- - get_active_shift expected-cash field only;
-- - keep informational cash_sales/cash_in/cash_out/total_sales fields unchanged;
-- - no print, KDS, order, inventory, RLS or permission changes.

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.get_active_shift(uuid)'::regprocedure)
  INTO v_def;

  IF position('ACTIVE_SHIFT_CANONICAL_EXPECTED_CASH' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_old :=
    '  v_expected := round(' || E'\n' ||
    '    COALESCE(v_shift.opening_amount, 0) + v_cash_sales + v_cash_inflows - v_cash_outflows,' || E'\n' ||
    '    2' || E'\n' ||
    '  );';

  v_new :=
    '  -- ACTIVE_SHIFT_CANONICAL_EXPECTED_CASH' || E'\n' ||
    '  -- One source of truth for the live drawer and close/report calculations.' || E'\n' ||
    '  v_expected := public._compute_shift_expected_cash(v_shift.id);';

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_active_shift expected-cash marker drift; refusing patch';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch$;
