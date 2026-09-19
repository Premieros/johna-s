-- Repair POS permission/UI contract for sent-item voids and retire stale
-- empty table-order shells.
--
-- Rules:
-- 1) pos.void is the direct execution permission for an already-sent item.
--    approvals.review keeps its existing reviewer bypass.
-- 2) Users without either capability remain on the manager-approval path.
-- 3) Empty open/held table orders are non-operational and are retired.
-- 4) Kitchen-void printing remains owned by trg_enqueue_kitchen_void_print;
--    this migration does not touch print routing, cloud_print_jobs or the agent.

DO $patch_void_permissions$
DECLARE
  v_name text;
  v_sig regprocedure;
  v_def text;
  v_next text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['cancel_sent_order_item_exact','cancel_sent_order_item']
  LOOP
    IF v_name = 'cancel_sent_order_item_exact' THEN
      v_sig := to_regprocedure('public.cancel_sent_order_item_exact(uuid,uuid,numeric,text)');
    ELSE
      v_sig := to_regprocedure('public.cancel_sent_order_item(uuid,uuid,numeric,text)');
    END IF;

    IF v_sig IS NULL THEN
      RAISE EXCEPTION '% target not found', v_name;
    END IF;

    SELECT pg_get_functiondef(v_sig) INTO v_def;

    IF position('can_permission(''pos.void'')' in v_def) > 0 THEN
      CONTINUE;
    END IF;

    v_next := regexp_replace(
      v_def,
      'v_privileged[[:space:]]*:=[[:space:]]*public\.is_pos_admin\(\)[[:space:]]+OR[[:space:]]+public\.can_permission\(''approvals\.review''\)[[:space:]]*;',
      'v_privileged := public.can_permission(''pos.void'') OR public.can_permission(''approvals.review'');',
      'i'
    );

    IF v_next = v_def
       OR position('can_permission(''pos.void'')' in v_next) = 0 THEN
      RAISE EXCEPTION '% permission patch pattern changed; refusing migration', v_name;
    END IF;

    EXECUTE v_next;
  END LOOP;
END;
$patch_void_permissions$;

-- Retire stale table-attached order shells left after their last item was
-- removed/voided. These rows carry no operational quantity and must not
-- continue to appear as active table orders.
UPDATE public.orders o
SET status = 'cancelled',
    updated_at = now(),
    completed_at = COALESCE(o.completed_at, now()),
    notes = concat_ws(
      E'\n',
      NULLIF(o.notes, ''),
      '[System cleanup: empty table order retired]'
    )
WHERE o.table_id IS NOT NULL
  AND o.status IN ('open','held')
  AND NOT EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id = o.id
      AND COALESCE(oi.quantity, 0) > 0
  );

-- Re-derive table status from effective active orders after cleanup.
UPDATE public.dining_tables t
SET status = 'vacant',
    updated_at = now()
WHERE t.status <> 'closed'
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = t.id
      AND o.status IN ('open','held')
      AND EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
          AND COALESCE(oi.quantity, 0) > 0
      )
  );

NOTIFY pgrst, 'reload schema';
