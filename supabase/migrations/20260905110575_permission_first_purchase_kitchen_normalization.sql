-- Normalize the last role-label authorization gates before the final fail-closed audit.
-- Capabilities come from roles.permissions; role labels only describe users.

DO $$
DECLARE
  r record;
  d text;
  n text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'delete_purchase_invoice',
        'get_kitchen_station_assignments',
        'get_kitchen_station_editor_context',
        'save_kitchen_station_assignments'
      )
  LOOP
    d := r.def;
    n := d;

    IF r.proname = 'delete_purchase_invoice' THEN
      n := regexp_replace(
        n,
        'IF[[:space:]]+NOT[[:space:]]+(public\.)?can_permission\(''purchases\.manage''\)[[:space:]]+AND[[:space:]]+v_role[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN',
        'IF NOT public.can_permission(''purchases.delete'') THEN',
        'gi'
      );
    ELSE
      n := regexp_replace(
        n,
        'v_role[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)',
        'NOT public.can_permission(''settings.manage'')',
        'gi'
      );
    END IF;

    IF n IS DISTINCT FROM d THEN
      EXECUTE n;
    END IF;
  END LOOP;
END;
$$;
