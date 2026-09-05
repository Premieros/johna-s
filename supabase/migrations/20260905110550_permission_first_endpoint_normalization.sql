-- Normalize endpoints that historically carried role fallbacks before the final
-- runtime reconciliation/audit. This migration is intentionally capability-only.
DO $$
DECLARE r record; d text; n text; v_permission text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public'
      AND p.prokind='f'
      AND p.proname IN (
        'delete_purchase_invoice',
        'get_kitchen_station_assignments',
        'get_kitchen_station_editor_context',
        'save_kitchen_station_assignments',
        'save_product_modifiers'
      )
  LOOP
    d := r.def;
    n := d;

    IF r.proname='delete_purchase_invoice' THEN
      v_permission := 'purchases.delete';
    ELSIF r.proname IN ('get_kitchen_station_assignments','get_kitchen_station_editor_context','save_kitchen_station_assignments') THEN
      v_permission := 'settings.manage';
    ELSE
      v_permission := 'products.modifiers.manage';
    END IF;

    -- Exact legacy modifier alias.
    n := replace(n, '''products.manage''', '''products.modifiers.manage''');

    -- Remove historical get_user_role-based capability gates while preserving
    -- the surrounding branch/scope checks. Supports nested or combined forms.
    n := regexp_replace(
      n,
      'IF[[:space:]]+get_user_role\(\)[[:space:]]+(NOT[[:space:]]+)?IN[[:space:]]*\([^)]*\)[[:space:]]+THEN',
      format('IF NOT public.can_permission(%L) THEN', v_permission),
      'gi'
    );
    n := regexp_replace(
      n,
      'IF[[:space:]]+get_user_role\(\)[[:space:]]*(=|<>)[[:space:]]*''[^'']+''[[:space:]]+THEN',
      format('IF NOT public.can_permission(%L) THEN', v_permission),
      'gi'
    );

    IF n IS DISTINCT FROM d THEN EXECUTE n; END IF;
  END LOOP;
END;
$$;
