BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates) THEN RAISE EXCEPTION 'ROLLBACK_REQUIRES_NO_ACTIVATED_COORDINATES'; END IF; END $$;
CREATE OR REPLACE FUNCTION private.apply_raw_stock_count_last_price(p_stock_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count public.stock_counts%ROWTYPE;
  v_item public.stock_count_items%ROWTYPE;
  v_current numeric(14,4);
  v_lock_raw uuid;
  v_prices jsonb;
  v_positions jsonb;
  v_price_data jsonb;
  v_valuation_at timestamptz:=statement_timestamp();
  v_later_delta numeric;
  v_ledger_at_creation numeric;
  v_expected_current numeric;
  v_final_price numeric(18,6);
  v_price_source text;
  v_variance numeric(14,4);
  v_applied integer := 0;
  v_res jsonb;
  v_shortage numeric(14,4);
  v_value numeric(14,2);
  v_fg_delta numeric(14,2) := 0;
  v_rm_delta numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_journal_id uuid;
BEGIN
  BEGIN
    SELECT *
      INTO v_count
      FROM public.stock_counts
      WHERE id = p_stock_count_id
      FOR UPDATE;

    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;

    IF v_count.status <> 'approved' THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_APPROVED', 'status', v_count.status);
    END IF;

    IF NOT public.can_permission('inventory.count.apply') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NOT public.user_may_access_branch(v_count.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=v_count.warehouse_id AND branch_id=v_count.branch_id AND is_active) THEN
      RAISE EXCEPTION 'WAREHOUSE_BRANCH_MISMATCH';
    END IF;
    IF EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=v_count.id
      AND (counted_quantity IS NULL OR counted_quantity<0 OR (raw_material_id IS NULL AND product_id IS NULL)
        OR (raw_material_id IS NOT NULL AND product_id IS NOT NULL)))
      OR EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=v_count.id AND raw_material_id IS NOT NULL
        GROUP BY raw_material_id HAVING count(*)>1) THEN
      RAISE EXCEPTION 'STOCK_COUNT_INVALID_LINES';
    END IF;

    IF EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=v_count.id AND product_id IS NOT NULL) THEN
      RAISE EXCEPTION 'RAW_ONLY_STOCK_COUNT_REQUIRED';
    END IF;
    IF EXISTS(SELECT 1 FROM public.inventory_ledger WHERE reference_type='stock_count' AND reference_id=v_count.id)
      OR EXISTS(SELECT 1 FROM public.journal_entries WHERE reference_type='stock_count' AND reference_id=v_count.id) THEN
      RAISE EXCEPTION 'COUNT_EXISTING_POSTING_REQUIRES_REVIEW';
    END IF;

    -- A later applied count supersedes this count on overlapping coordinates.
    IF EXISTS (
      SELECT 1 FROM public.stock_count_items original
      JOIN public.stock_counts later ON later.branch_id=v_count.branch_id
        AND later.warehouse_id=v_count.warehouse_id AND later.status='applied'
        AND later.created_at>v_count.created_at
      JOIN public.stock_count_items line ON line.stock_count_id=later.id
        AND (line.raw_material_id=original.raw_material_id OR line.product_id=original.product_id)
      WHERE original.stock_count_id=v_count.id
    ) THEN
      RETURN jsonb_build_object('success',false,'error','LATER_STOCK_COUNT_ALREADY_APPLIED');
    END IF;

    -- Use the same locks as live raw sales/receipts, in stable order. A busy
    -- coordinate returns promptly rather than making the till wait for a count.
    FOR v_lock_raw IN SELECT DISTINCT raw_material_id FROM public.stock_count_items
      WHERE stock_count_id=p_stock_count_id AND raw_material_id IS NOT NULL ORDER BY raw_material_id
    LOOP
      IF NOT pg_try_advisory_xact_lock(hashtextextended(v_lock_raw::text||':'||v_count.branch_id::text,0)) THEN
        RAISE EXCEPTION 'STOCK_COUNT_STOCK_BUSY_RETRY';
      END IF;
    END LOOP;

    -- Count lines and all stock coordinates are locked before taking the
    -- shared snapshots. No per-item full movement-history/price query follows.
    PERFORM 1 FROM public.stock_count_items WHERE stock_count_id=p_stock_count_id ORDER BY id FOR UPDATE;
    -- Validate every negative lot once, not once per lot or per receipt.
    IF EXISTS (
      WITH materials AS MATERIALIZED (SELECT raw_material_id FROM public.stock_count_items WHERE stock_count_id=p_stock_count_id),
      debt AS MATERIALIZED (
        SELECT d.raw_material_id,d.oversold_batch_id,sum(d.debt_quantity-d.settled_quantity) qty
        FROM public.raw_fifo_debts d JOIN materials m USING(raw_material_id)
        WHERE d.branch_id=v_count.branch_id AND d.warehouse_id=v_count.warehouse_id AND d.settled_quantity<d.debt_quantity
        GROUP BY d.raw_material_id,d.oversold_batch_id
      ), negative AS MATERIALIZED (
        SELECT b.raw_material_id,b.id,b.quantity FROM public.raw_material_batches b JOIN materials m USING(raw_material_id)
        WHERE b.branch_id=v_count.branch_id AND b.warehouse_id=v_count.warehouse_id AND b.quantity<0
      ) SELECT 1 FROM negative b FULL JOIN debt d ON d.raw_material_id=b.raw_material_id AND d.oversold_batch_id=b.id
        WHERE b.id IS NULL OR d.oversold_batch_id IS NULL OR -b.quantity IS DISTINCT FROM d.qty
    ) THEN RAISE EXCEPTION 'COUNT_LEGACY_QUANTITY_UNRECONCILED'; END IF;
    SELECT jsonb_object_agg(p.raw_material_id::text,to_jsonb(p)||jsonb_build_object('quantity_verified',true,'defer_quantity_offset',true)) INTO v_prices
      FROM private.stock_count_raw_price(v_count.branch_id,
        ARRAY(SELECT raw_material_id FROM public.stock_count_items WHERE stock_count_id=p_stock_count_id),v_valuation_at) p;
    WITH materials AS MATERIALIZED (
      SELECT raw_material_id FROM public.stock_count_items WHERE stock_count_id=p_stock_count_id
    ), history AS (
      SELECT l.raw_material_id,
        coalesce(sum(l.quantity) FILTER(WHERE l.created_at<=v_count.created_at),0) historic,
        coalesce(sum(l.quantity) FILTER(WHERE l.created_at>v_count.created_at),0) later
      FROM public.inventory_ledger l JOIN materials m ON m.raw_material_id=l.raw_material_id
      WHERE l.branch_id=v_count.branch_id AND l.warehouse_id=v_count.warehouse_id GROUP BY l.raw_material_id
    ), physical AS (
      SELECT b.raw_material_id,sum(b.quantity) qty FROM public.raw_material_batches b
      JOIN materials m ON m.raw_material_id=b.raw_material_id
      WHERE b.branch_id=v_count.branch_id AND b.warehouse_id=v_count.warehouse_id GROUP BY b.raw_material_id
    ) SELECT jsonb_object_agg(m.raw_material_id::text,jsonb_build_object(
      'current',coalesce(p.qty,0),'historic',coalesce(h.historic,0),'later',coalesce(h.later,0)))
      INTO v_positions FROM materials m LEFT JOIN history h USING(raw_material_id) LEFT JOIN physical p USING(raw_material_id);

    FOR v_item IN
      SELECT *
      FROM public.stock_count_items
      WHERE stock_count_id = p_stock_count_id
      ORDER BY id
      FOR UPDATE
    LOOP
      v_value := 0;

      IF v_item.raw_material_id IS NOT NULL THEN
        -- Take the same canonical material/branch lock as approved-v2 issue
        -- and receipt BEFORE reading warehouse stock. Without it a sale or
        -- transfer can move quantity between the count snapshot and posting.
        PERFORM pg_advisory_xact_lock(hashtextextended(
          v_item.raw_material_id::text||':'||v_count.branch_id::text,0
        ));
        -- Price uses the latest published source at posting; the quantity cutoff
        -- remains the count creation time. These timestamps are independent.
        v_price_data:=v_prices->v_item.raw_material_id::text;
        v_final_price:=(v_price_data->>'unit_cost')::numeric;
        v_price_source:=v_price_data->>'price_source';
        -- Explicitly recorded zero is a valid cost. Missing (NULL / unpriced)
        -- and negative prices are invalid. The source projection must be updated
        -- separately to preserve legitimate zero-priced source events.
        -- Applied historical stock counts are filtered by its visibility predicate.
        IF v_final_price IS NULL OR v_final_price < 0
           OR v_price_source IS NULL
           OR v_price_source NOT IN ('purchase','pricing','stock_count','catalog_zero') THEN
          RAISE EXCEPTION 'APPROVED_RAW_PRICE_UNAVAILABLE material % branch % as_of %',
            v_item.raw_material_id,v_count.branch_id,v_count.created_at;
        END IF;
        -- Freeze the approved price actually used at posting on the count line.
        -- The existing stock-count source trigger is NOT authoritative until
        -- the parent count becomes applied; this preserves source lineage.
        IF v_item.unit_cost IS DISTINCT FROM v_final_price THEN
          UPDATE public.stock_count_items
             SET unit_cost = v_final_price
           WHERE id = v_item.id AND stock_count_id = v_count.id;
        END IF;
        v_current:=(v_positions->v_item.raw_material_id::text->>'current')::numeric;
        v_later_delta:=(v_positions->v_item.raw_material_id::text->>'later')::numeric;
        v_ledger_at_creation:=(v_positions->v_item.raw_material_id::text->>'historic')::numeric;
        IF v_current-v_later_delta IS DISTINCT FROM v_ledger_at_creation THEN
          RAISE EXCEPTION 'STOCK_COUNT_HISTORICAL_BASELINE_UNVERIFIED item %',v_item.id;
        END IF;
        -- Persist the verified historical baseline so the document shows the
        -- same variance as its stock ledger and accounting entry.
        UPDATE public.stock_count_items SET system_quantity=v_ledger_at_creation
          WHERE id=v_item.id AND system_quantity IS DISTINCT FROM v_ledger_at_creation;
        v_variance := v_item.counted_quantity - (v_current - v_later_delta);
        v_expected_current := v_current + v_variance;

        IF v_variance > 0 THEN
          -- Candidate-only approved-price physical receipt; no legacy FIFO writer.
          v_res := private.raw_receive_approved_v2(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            v_variance, v_final_price,
            'adjustment', 'stock_count', v_count.id, v_count.count_number, auth.uid(), v_valuation_at, v_count.created_at, v_price_data
          );
          IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED: %', 'RAW_ADJUST_FAILED';
          END IF;
          v_value := round(v_variance * v_final_price, 2);
          -- A successful helper response is insufficient: a partial receipt or
          -- receipt-side legacy debt absorption may silently break journal parity.
          IF COALESCE((v_res->>'after_qty')::numeric,0)
               - COALESCE((v_res->>'before_qty')::numeric,0) IS DISTINCT FROM v_variance
             OR NOT EXISTS (
               SELECT 1 FROM public.inventory_ledger il
               WHERE il.id=(v_res->>'receipt_ledger_id')::bigint
                 AND il.reference_id=v_count.id AND il.reference_type='stock_count'
                 AND il.raw_material_id=v_item.raw_material_id
                 AND il.warehouse_id=v_count.warehouse_id
                 AND il.quantity=v_variance
                 AND round(il.total_cost,2)=v_value
             ) THEN
            RAISE EXCEPTION 'STOCK_COUNT_APPROVED_RECEIPT_MISMATCH raw %',v_item.raw_material_id;
          END IF;
          v_rm_delta := v_rm_delta + v_value;
        ELSIF v_variance < 0 THEN
          v_res := private.raw_issue_approved_v2(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            -v_variance, 'adjustment', 'stock_count', v_count.id,
            v_count.count_number, auth.uid(), v_valuation_at, v_count.created_at, v_price_data
          );
          IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
            RAISE EXCEPTION 'STOCK_COUNT_REMOVE_FAILED: %',COALESCE(v_res->>'error','unknown');
          END IF;
          v_shortage := COALESCE((v_res->>'shortage')::numeric, 0);
          IF v_shortage > 0 THEN
            RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED: %', 'STOCK_COUNT_SHORTAGE';
          END IF;
          -- Approved-price v2 movement emits the physical ledger at the same
          -- canonical approved price as the balancing accounting journal.
          -- No FIFO valuation, zero-quantity revaluation bridge or debt replay.
          v_value := round(-v_variance * v_final_price, 2);
          IF COALESCE((v_res->>'removed')::numeric,0) IS DISTINCT FROM -v_variance
             OR round(COALESCE((v_res->>'total_cost')::numeric,0),2) IS DISTINCT FROM v_value THEN
            RAISE EXCEPTION 'STOCK_COUNT_APPROVED_MOVEMENT_MISMATCH raw %',v_item.raw_material_id;
          END IF;
          v_rm_delta := v_rm_delta - v_value;
        END IF;
        -- Both receipt and issue paths must leave the specific warehouse at
        -- the physically counted quantity. Never infer this only from a
        -- helper success flag or posted journal/ledger amounts.
        SELECT COALESCE(quantity,0) INTO v_current
          FROM public.raw_material_warehouse_inventory
         WHERE raw_material_id=v_item.raw_material_id
           AND branch_id=v_count.branch_id
           AND warehouse_id=v_count.warehouse_id;
        IF COALESCE(v_current,0) IS DISTINCT FROM v_expected_current THEN
          RAISE EXCEPTION 'STOCK_COUNT_WAREHOUSE_QUANTITY_MISMATCH material % expected % actual %',
            v_item.raw_material_id,v_expected_current,COALESCE(v_current,0);
        END IF;
      END IF;

      v_applied := v_applied + 1;
    END LOOP;

    IF v_fg_delta > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_fg', 'debit', round(v_fg_delta, 2), 'credit', 0,
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', 0, 'credit', round(v_fg_delta, 2),
        'note', v_count.count_number || ' · finished goods'
      );
    ELSIF v_fg_delta < 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_fg', 'debit', 0, 'credit', round(-v_fg_delta, 2),
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', round(-v_fg_delta, 2), 'credit', 0,
        'note', v_count.count_number || ' · finished goods'
      );
    END IF;

    IF v_rm_delta > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_rm', 'debit', round(v_rm_delta, 2), 'credit', 0,
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', 0, 'credit', round(v_rm_delta, 2),
        'note', v_count.count_number || ' · raw materials'
      );
    ELSIF v_rm_delta < 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_rm', 'debit', 0, 'credit', round(-v_rm_delta, 2),
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', round(-v_rm_delta, 2), 'credit', 0,
        'note', v_count.count_number || ' · raw materials'
      );
    END IF;

    IF jsonb_array_length(v_lines) > 0 THEN
      v_journal_id := public._post_journal_entry(
        v_count.branch_id,
        'stock_count',
        v_count.id,
        v_count.count_number,
        'تسوية جرد ' || COALESCE(v_count.count_number, v_count.id::text),
        v_lines
      );
    END IF;

    UPDATE public.stock_counts
    SET status = 'applied', applied_at = now()
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object(
      'success', true,
      'items_applied', v_applied,
      'journal_entry_id', v_journal_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TRANSACTION_FAILED',
        'detail', SQLERRM
      );
  END;
END;
$function$
;
CREATE OR REPLACE FUNCTION private.latest_approved_raw_prices(p_branch_id uuid, p_raw_material_ids uuid[], p_as_of timestamp with time zone)
 RETURNS TABLE(raw_material_id uuid, branch_id uuid, unit_cost numeric, price_source text, priced_at timestamp with time zone, reference_number text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT rm.id,rm.branch_id,w.unit_cost,COALESCE(w.price_source,'unpriced'),w.priced_at,w.reference_number
 FROM public.raw_materials rm
 LEFT JOIN LATERAL (
  SELECT CASE WHEN c.source_kind='purchase_items' THEN (norm.value->>'stock_unit_cost')::numeric(18,6) ELSE c.unit_cost::numeric(18,6) END AS unit_cost,
   CASE WHEN c.source_kind IN('inventory_ledger','purchase_items') THEN 'purchase' WHEN c.source_kind='stock_count_items' THEN 'stock_count' ELSE 'pricing' END AS price_source,
   c.priced_at,c.reference_number
  FROM private.raw_approved_price_read_model c
  LEFT JOIN LATERAL(SELECT public._normalize_raw_purchase_uom(c.raw_material_id,c.purchase_quantity,c.unit_cost,c.purchase_unit) AS value WHERE c.source_kind='purchase_items') norm ON true
  WHERE c.branch_id=rm.branch_id AND c.raw_material_id=rm.id AND (p_as_of IS NULL OR c.priced_at<=p_as_of)
   AND private.raw_approved_price_visible(c.source_kind,c.source_id,c.parent_id,c.raw_material_id,c.branch_id)
   AND (c.source_kind<>'purchase_items' OR (COALESCE((norm.value->>'success')::boolean,false) AND COALESCE((norm.value->>'stock_unit_cost')::numeric,0)>0))
  ORDER BY c.priced_at DESC NULLS LAST,c.source_rank,c.reference_number DESC NULLS LAST,c.event_id DESC LIMIT 1
 ) w ON true
 WHERE (p_branch_id IS NULL OR rm.branch_id=p_branch_id) AND(p_raw_material_ids IS NULL OR rm.id=ANY(p_raw_material_ids));
$function$
;
CREATE OR REPLACE FUNCTION private.offset_stock_count_legacy_quantity(p_receipt_id bigint, p_batch_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  r public.inventory_ledger%ROWTYPE;
  b public.raw_material_batches%ROWTYPE;
  remaining numeric;
  inserted_n bigint;
  debt_n bigint;
  batch_n bigint;
  expected_batch_n bigint;
  estimate_n bigint;
  absorbed numeric:=0;
BEGIN
  SELECT * INTO STRICT r FROM public.inventory_ledger WHERE id=p_receipt_id FOR UPDATE;
  IF r.reference_type IS DISTINCT FROM 'stock_count' OR r.raw_material_id IS NULL OR r.quantity<=0 THEN
    RAISE EXCEPTION 'COUNT_RECEIPT_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.raw_material_id::text||':'||r.branch_id::text,0));
  SELECT * INTO STRICT b FROM public.raw_material_batches WHERE id=p_batch_id FOR UPDATE;
  IF ROW(b.raw_material_id,b.branch_id,b.warehouse_id,b.batch_number)
     IS DISTINCT FROM ROW(r.raw_material_id,r.branch_id,r.warehouse_id,r.batch_number) THEN
    RAISE EXCEPTION 'COUNT_RECEIPT_BATCH_MISMATCH';
  END IF;
  -- A receipt can be retried after partially settling multiple debts. Its total
  -- absorbed quantity must never exceed its original physical quantity.
  SELECT greatest(0,least(b.quantity,r.quantity-COALESCE(sum(s.quantity),0)))
    INTO remaining FROM public.raw_fifo_settlements s
    WHERE s.receipt_ledger_id=r.id;
  IF b.quantity<0 THEN RAISE EXCEPTION 'COUNT_RECEIPT_BATCH_NEGATIVE'; END IF;
  IF remaining<=0 THEN RETURN 0; END IF;
  WITH locked AS MATERIALIZED (
    SELECT f.id,f.oversold_batch_id,f.source_created_at,f.debt_quantity-f.settled_quantity outstanding
    FROM public.raw_fifo_debts f WHERE f.raw_material_id=r.raw_material_id AND f.branch_id=r.branch_id
      AND f.warehouse_id=r.warehouse_id AND f.source_created_at<=r.created_at
      AND f.settled_quantity<f.debt_quantity
      AND NOT EXISTS(SELECT 1 FROM public.raw_fifo_settlements s WHERE s.debt_id=f.id AND s.receipt_ledger_id=r.id)
    ORDER BY f.source_created_at,f.id LIMIT greatest(1,least(500,coalesce(nullif(current_setting('app.stock_count_cleanup_limit',true),''),'500')::integer)) FOR UPDATE
  ), allocation AS MATERIALIZED (
    SELECT id,oversold_batch_id,greatest(0,least(outstanding,remaining-coalesce(
      sum(outstanding) OVER(ORDER BY source_created_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0))) take_qty
    FROM locked
  ), inserted AS (
    INSERT INTO public.raw_fifo_settlements(debt_id,receipt_ledger_id,receipt_batch_id,quantity,unit_cost,total_cost)
    SELECT id,r.id,b.id,take_qty,0,0 FROM allocation WHERE take_qty>0
    ON CONFLICT(debt_id,receipt_ledger_id) DO NOTHING RETURNING debt_id,quantity
  ), batch_allocation AS MATERIALIZED (
    SELECT a.oversold_batch_id,sum(i.quantity) qty FROM inserted i JOIN allocation a ON a.id=i.debt_id
    GROUP BY a.oversold_batch_id
  ), batches_updated AS (
    UPDATE public.raw_material_batches n SET quantity=n.quantity+a.qty FROM batch_allocation a
    WHERE n.id=a.oversold_batch_id AND n.raw_material_id=r.raw_material_id AND n.branch_id=r.branch_id
      AND n.warehouse_id=r.warehouse_id AND n.quantity<=-a.qty RETURNING n.id
  ), debts_updated AS (
    UPDATE public.raw_fifo_debts d SET settled_quantity=d.settled_quantity+i.quantity,updated_at=clock_timestamp()
    FROM inserted i WHERE d.id=i.debt_id AND d.settled_quantity+i.quantity<=d.debt_quantity RETURNING d.id
  ), estimates_updated AS (
    UPDATE public.raw_fifo_debt_price_estimates e
      SET zero_cost_finalized_quantity=e.zero_cost_finalized_quantity+least(i.quantity,e.remaining_estimated_quantity),
          remaining_estimated_quantity=greatest(e.remaining_estimated_quantity-i.quantity,0),updated_at=clock_timestamp()
    FROM inserted i WHERE e.debt_id=i.debt_id AND e.remaining_estimated_quantity>0 RETURNING e.debt_id
  ) SELECT coalesce(sum(i.quantity),0),count(*),(SELECT count(*) FROM debts_updated),
      (SELECT count(*) FROM batches_updated),(SELECT count(*) FROM batch_allocation),(SELECT count(*) FROM estimates_updated)
    INTO absorbed,inserted_n,debt_n,batch_n,expected_batch_n,estimate_n FROM inserted i;
  IF debt_n<>inserted_n OR batch_n<>expected_batch_n THEN
    RAISE EXCEPTION 'COUNT_NEGATIVE_BATCH_UNRECONCILED';
  END IF;
  IF absorbed>0 THEN
    UPDATE public.raw_material_batches SET quantity=quantity-absorbed WHERE id=b.id AND quantity>=absorbed;
    IF NOT FOUND THEN RAISE EXCEPTION 'COUNT_RECEIPT_BATCH_NEGATIVE'; END IF;
  END IF;
  RETURN absorbed;
END;
$function$
;
CREATE OR REPLACE FUNCTION private.raw_approved_price_visible(p_kind text, p_source_id text, p_parent_id uuid, p_raw uuid, p_branch uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE
 WHEN p_kind IN ('inventory_ledger','purchase_items') THEN EXISTS (
  SELECT 1 FROM public.purchases p WHERE p.id=p_parent_id AND p.branch_id=p_branch AND p.status='completed'
  AND ((auth.uid() IS NULL AND current_user IN ('postgres','service_role')) OR private.financial_row_visible(p.id,p.branch_id,p.created_at))
  AND CASE WHEN p_kind='inventory_ledger' THEN EXISTS (
   SELECT 1 FROM public.inventory_ledger il WHERE il.id=p_source_id::bigint AND il.reference_id=p.id
    AND il.reference_type='purchase' AND il.entry_type='purchase' AND il.raw_material_id=p_raw AND il.branch_id=p_branch)
  ELSE EXISTS (SELECT 1 FROM public.purchase_items pi WHERE pi.id=p_source_id::uuid AND pi.purchase_id=p.id AND pi.raw_material_id=p_raw) END
  AND (p_kind<>'purchase_items' OR NOT EXISTS (
   SELECT 1 FROM public.inventory_ledger il WHERE il.reference_id=p.id AND il.reference_type='purchase'
    AND il.entry_type='purchase' AND il.raw_material_id=p_raw)))
 WHEN p_kind='stock_count_items' THEN EXISTS (
  SELECT 1 FROM public.stock_counts sc JOIN public.stock_count_items sci ON sci.stock_count_id=sc.id
  WHERE sc.id=p_parent_id AND sc.branch_id=p_branch AND sc.status='applied' AND sci.id=p_source_id::uuid AND sci.raw_material_id=p_raw)
 WHEN p_kind='raw_material_price_events' THEN EXISTS (
  SELECT 1 FROM public.raw_material_price_events pe WHERE pe.id=p_source_id::uuid AND pe.raw_material_id=p_raw AND pe.branch_id=p_branch)
 ELSE false END;
$function$
;
CREATE OR REPLACE FUNCTION private.raw_issue_approved_v2(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_entry_type text, p_reference_type text, p_reference_id uuid, p_reference_number text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_valuation_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_effective_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_frozen_price jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_price record;
  v_batch record;
  v_qty numeric(18,6);
  v_take numeric(18,6);
  v_before numeric(18,6);
  v_running numeric(18,6);
  v_batch_no text;
  v_shortage_basis numeric(20,6);
  v_branch_qty numeric(18,6);
  v_branch_value numeric(20,6);
  v_ledger_id bigint;
  v_count_deficit_batch uuid;
  v_now timestamptz:=statement_timestamp();
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_warehouse_id IS NULL
     OR p_raw_material_id IS NULL OR p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_INPUT');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses w
    WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active)
    OR NOT EXISTS(SELECT 1 FROM public.raw_materials m
    WHERE m.id=p_raw_material_id AND m.branch_id=p_branch_id AND m.is_active) THEN
    RETURN jsonb_build_object('success',false,'error','RAW_WAREHOUSE_BRANCH_MISMATCH');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  IF p_reference_type='stock_count' THEN
    IF coalesce((p_frozen_price->>'quantity_verified')::boolean,false) IS NOT TRUE THEN
      PERFORM private.validate_count_legacy_quantity(p_raw_material_id,p_branch_id,p_warehouse_id);
    END IF;
  ELSE
  IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d
    WHERE d.raw_material_id=p_raw_material_id
      AND d.warehouse_id=p_warehouse_id AND d.branch_id=p_branch_id
      AND d.settled_quantity<d.debt_quantity)
    OR EXISTS(SELECT 1 FROM public.raw_material_batches b
    WHERE b.raw_material_id=p_raw_material_id AND b.warehouse_id=p_warehouse_id
      AND b.branch_id=p_branch_id AND b.quantity<0
      AND b.source_type<>'approved_shortage_aggregate') THEN
    RETURN jsonb_build_object('success',false,'error','LEGACY_FIFO_POSITION_NOT_CUTOVER');
  END IF;
  END IF;
  IF p_frozen_price IS NOT NULL THEN
    IF p_reference_type IS DISTINCT FROM 'stock_count'
      OR (p_frozen_price->>'raw_material_id')::uuid IS DISTINCT FROM p_raw_material_id
      OR (p_frozen_price->>'branch_id')::uuid IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'STOCK_COUNT_PRICE_CONTEXT_MISMATCH';
    END IF;
    SELECT (p_frozen_price->>'unit_cost')::numeric unit_cost,
      p_frozen_price->>'price_source' price_source,
      (p_frozen_price->>'priced_at')::timestamptz priced_at,
      p_frozen_price->>'reference_number' reference_number INTO v_price;
  ELSE
  SELECT * INTO v_price FROM private.latest_approved_raw_prices(
    p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
  WHERE raw_material_id=p_raw_material_id;
  IF p_reference_type='stock_count' AND v_price.unit_cost IS NULL THEN
    SELECT * INTO v_price FROM private.stock_count_raw_price(
      p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
    WHERE raw_material_id=p_raw_material_id;
  END IF;
  END IF;
  IF v_price.unit_cost IS NULL OR v_price.unit_cost<0
    OR v_price.priced_at IS NULL
    OR v_price.price_source NOT IN ('purchase','pricing','stock_count','catalog_zero') THEN
    RETURN jsonb_build_object('success',false,'error','APPROVED_RAW_PRICE_UNAVAILABLE');
  END IF;
  SELECT COALESCE(SUM(quantity),0) INTO v_before
    FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id;
  v_running:=v_before;
  v_qty:=p_qty;

  FOR v_batch IN
    SELECT b.id,b.batch_number,b.quantity,b.expiry_date
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=p_raw_material_id AND b.branch_id=p_branch_id
      AND b.warehouse_id=p_warehouse_id AND b.quantity>0
    ORDER BY b.expiry_date NULLS LAST,b.created_at,b.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_qty<=0;
    v_take:=LEAST(v_qty,v_batch.quantity);
    UPDATE public.raw_material_batches SET quantity=quantity-v_take WHERE id=v_batch.id;
    IF p_reference_type IS DISTINCT FROM 'stock_count' THEN
    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,
      unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,
      reference_id,reference_number,created_by,created_at,
      approved_cost_basis,approved_price_source,approved_price_at,
      approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,-v_take,
      v_price.unit_cost,-v_take*v_price.unit_cost,v_running,v_running-v_take,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,v_now),
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    );
    END IF;
    v_running:=v_running-v_take;
    v_qty:=v_qty-v_take;
  END LOOP;

  IF v_qty>0 THEN
    IF p_reference_type='stock_count' THEN
      INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,source_id)
      VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,'SC-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
        -v_qty,v_price.unit_cost,'stock_count_oversold',p_reference_id)
      RETURNING id,batch_number INTO v_count_deficit_batch,v_batch_no;
    ELSE
    INSERT INTO public.raw_material_batches(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,production_date,expiry_date,
      source_type,source_id,approved_shortage_total_cost
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,
      'AS-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
      -v_qty,v_price.unit_cost,NULL,NULL,'approved_shortage_aggregate',NULL,
      v_qty*v_price.unit_cost
    )
    ON CONFLICT(branch_id,warehouse_id,raw_material_id)
      WHERE source_type='approved_shortage_aggregate'
    DO UPDATE SET
      quantity=public.raw_material_batches.quantity+EXCLUDED.quantity,
      approved_shortage_total_cost=
        public.raw_material_batches.approved_shortage_total_cost
        +EXCLUDED.approved_shortage_total_cost,
      unit_cost=(public.raw_material_batches.approved_shortage_total_cost
        +EXCLUDED.approved_shortage_total_cost)
        / abs(public.raw_material_batches.quantity+EXCLUDED.quantity)
    RETURNING batch_number INTO v_batch_no;

    END IF;

    IF p_reference_type IS DISTINCT FROM 'stock_count' THEN
    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,
      unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,
      reference_id,reference_number,created_by,created_at,
      approved_cost_basis,approved_price_source,approved_price_at,
      approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,-v_qty,
      v_price.unit_cost,-v_qty*v_price.unit_cost,v_running,v_running-v_qty,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,v_now),
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    ) RETURNING id INTO v_ledger_id;
    END IF;
  END IF;

  -- One monetary movement per counted raw material. Lot-level rounding
  -- must not create a different total from the count and its journal.
  IF p_reference_type='stock_count' THEN
    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,
      before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_by,created_at,
      approved_cost_basis,approved_price_source,approved_price_at,approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,NULL,-p_qty,v_price.unit_cost,-round(p_qty*v_price.unit_cost,2),
      v_before,v_before-p_qty,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,COALESCE(p_effective_at,v_now),
      'approved_last_known',v_price.price_source,v_price.priced_at,v_price.reference_number,v_now
    ) RETURNING id INTO v_ledger_id;
    IF v_count_deficit_batch IS NOT NULL THEN
      INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,
        reference_type,reference_id,reference_number,debt_quantity,source_created_at)
      VALUES(v_ledger_id,p_raw_material_id,p_branch_id,p_warehouse_id,v_count_deficit_batch,
        p_reference_type,p_reference_id,p_reference_number,v_qty,COALESCE(p_effective_at,v_now));
    END IF;
  END IF;

  SELECT COALESCE(sum(quantity),0),
    COALESCE(sum(quantity*COALESCE(unit_cost,0)),0)
  INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
  VALUES(p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET
    quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();
  RETURN jsonb_build_object(
    'success',true,'removed',p_qty,'oversold',v_qty,
    'total_cost',p_qty*v_price.unit_cost,'avg_cost',v_price.unit_cost,
    'approved_price_source',v_price.price_source,'approved_price_at',v_price.priced_at,
    'approved_price_ref',v_price.reference_number,
    'warehouse_id',p_warehouse_id,'shortage_ledger_id',v_ledger_id
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION private.raw_receive_approved_v2(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_receipt_unit_cost numeric, p_entry_type text, p_reference_type text, p_reference_id uuid, p_reference_number text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_valuation_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_effective_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_frozen_price jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_shortage public.raw_material_batches%ROWTYPE;
  v_approved_price record;
  v_approved_price_source text;
  v_approved_priced_at timestamptz;
  v_approved_price_ref text;
  v_shortage_absorbed numeric(18,6):=0;
  v_shortage_basis numeric(20,6):=0;
  v_variance numeric(20,6):=0;
  v_posted_variance numeric(18,2);
  v_available_after numeric(18,6);
  v_before numeric(18,6);
  v_branch_qty numeric(18,6);
  v_branch_value numeric(20,6);
  v_now timestamptz:=statement_timestamp();
  v_batch_no text;
  v_receipt_ledger bigint;
  v_receipt_batch uuid;
  v_journal uuid;
  v_journal_number text;
  v_variance_account uuid;
  v_inventory_account uuid;
  v_variance_reference uuid;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_receipt_unit_cost IS NULL
     OR p_receipt_unit_cost<0 OR p_warehouse_id IS NULL
     OR p_raw_material_id IS NULL OR p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','APPROVED_RECEIPT_INVALID_INPUT');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses w
      WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active)
    OR NOT EXISTS(SELECT 1 FROM public.raw_materials m
      WHERE m.id=p_raw_material_id AND m.branch_id=p_branch_id AND m.is_active) THEN
    RETURN jsonb_build_object('success',false,'error','RAW_WAREHOUSE_BRANCH_MISMATCH');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  IF p_reference_type='stock_count' THEN
    IF coalesce((p_frozen_price->>'quantity_verified')::boolean,false) IS NOT TRUE THEN
      PERFORM private.validate_count_legacy_quantity(p_raw_material_id,p_branch_id,p_warehouse_id);
    END IF;
  ELSE
  IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d WHERE d.raw_material_id=p_raw_material_id
    AND d.warehouse_id=p_warehouse_id AND d.branch_id=p_branch_id
    AND d.settled_quantity<d.debt_quantity)
    OR EXISTS(SELECT 1 FROM public.raw_material_batches b
      WHERE b.raw_material_id=p_raw_material_id AND b.warehouse_id=p_warehouse_id
        AND b.branch_id=p_branch_id AND b.quantity<0
        AND b.source_type<>'approved_shortage_aggregate') THEN
    RETURN jsonb_build_object('success',false,'error','LEGACY_FIFO_POSITION_NOT_CUTOVER');
  END IF;
  END IF;
  -- Stock-count receipts must use the very same historically approved price
  -- as the posting RPC and persist the source on the physical ledger.
  IF p_reference_type='stock_count' THEN
    IF p_frozen_price IS NOT NULL THEN
    IF p_reference_type IS DISTINCT FROM 'stock_count'
      OR (p_frozen_price->>'raw_material_id')::uuid IS DISTINCT FROM p_raw_material_id
      OR (p_frozen_price->>'branch_id')::uuid IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'STOCK_COUNT_PRICE_CONTEXT_MISMATCH';
    END IF;
    SELECT (p_frozen_price->>'unit_cost')::numeric unit_cost,
      p_frozen_price->>'price_source' price_source,
      (p_frozen_price->>'priced_at')::timestamptz priced_at,
      p_frozen_price->>'reference_number' reference_number INTO v_approved_price;
    ELSE
    SELECT * INTO v_approved_price FROM private.stock_count_raw_price(
      p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
    WHERE raw_material_id=p_raw_material_id;
    END IF;
    IF v_approved_price.unit_cost IS NULL OR v_approved_price.unit_cost<0
       OR v_approved_price.price_source NOT IN ('purchase','pricing','stock_count','catalog_zero')
       OR v_approved_price.unit_cost IS DISTINCT FROM p_receipt_unit_cost THEN
      RETURN jsonb_build_object('success',false,'error','APPROVED_RECEIPT_PRICE_MISMATCH');
    END IF;
    v_approved_price_source:=v_approved_price.price_source;
    v_approved_priced_at:=v_approved_price.priced_at;
    v_approved_price_ref:=v_approved_price.reference_number;
  END IF;
  SELECT COALESCE(sum(quantity),0) INTO v_before FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id;

  SELECT * INTO v_shortage FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id AND source_type='approved_shortage_aggregate'
    FOR UPDATE;
  IF v_shortage.id IS NOT NULL AND v_shortage.quantity<0 THEN
    v_shortage_absorbed:=LEAST(p_qty,abs(v_shortage.quantity));
    v_shortage_basis:=v_shortage_absorbed
      *(v_shortage.approved_shortage_total_cost/abs(v_shortage.quantity));
    v_variance:=v_shortage_absorbed*p_receipt_unit_cost-v_shortage_basis;
    UPDATE public.raw_material_batches SET
      quantity=v_shortage.quantity+v_shortage_absorbed,
      approved_shortage_total_cost=GREATEST(
        v_shortage.approved_shortage_total_cost-v_shortage_basis,0),
      unit_cost=CASE WHEN v_shortage.quantity+v_shortage_absorbed<0
        THEN GREATEST(v_shortage.approved_shortage_total_cost-v_shortage_basis,0)
            /abs(v_shortage.quantity+v_shortage_absorbed)
        ELSE 0 END
    WHERE id=v_shortage.id;
  END IF;
  v_available_after:=p_qty-v_shortage_absorbed;
  v_batch_no:='AR-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
  INSERT INTO public.raw_material_batches(
    raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,
    source_type,source_id
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,
    v_available_after,p_receipt_unit_cost,COALESCE(p_reference_type,p_entry_type),p_reference_id
  ) RETURNING id INTO v_receipt_batch;
  INSERT INTO public.inventory_ledger(
    raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,
    total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,
    reference_number,created_by,created_at,
    approved_cost_basis,approved_price_source,approved_price_at,
    approved_price_ref,approved_cost_recorded_at
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,p_qty,
    p_receipt_unit_cost,p_qty*p_receipt_unit_cost,v_before,v_before+p_qty,
    p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,v_now),
    CASE WHEN p_reference_type='stock_count' THEN 'approved_last_known' ELSE NULL END,
    v_approved_price_source,v_approved_priced_at,
    v_approved_price_ref,
    CASE WHEN p_reference_type='stock_count' THEN v_now ELSE NULL END
  ) RETURNING id INTO v_receipt_ledger;

  IF p_reference_type='stock_count' AND coalesce((p_frozen_price->>'defer_quantity_offset')::boolean,false) IS NOT TRUE THEN
    PERFORM private.offset_stock_count_legacy_quantity(v_receipt_ledger,v_receipt_batch);
  END IF;
  v_posted_variance:=round(v_variance,2);
  IF abs(v_posted_variance)>=0.01 THEN
    SELECT account_id INTO v_variance_account FROM public.account_mappings
      WHERE branch_id=p_branch_id AND semantic_key='stock_variance';
    SELECT account_id INTO v_inventory_account FROM public.account_mappings
      WHERE branch_id=p_branch_id AND semantic_key='inventory_rm';
    IF v_variance_account IS NULL OR v_inventory_account IS NULL
      OR v_variance_account=v_inventory_account THEN
      RAISE EXCEPTION 'APPROVED_COST_ACCOUNT_MAPPING_MISSING branch=%',p_branch_id;
    END IF;
    v_variance_reference:=md5('approved-raw-shortage-receipt:'||v_receipt_ledger::text)::uuid;
    v_journal_number:=(public.next_document_number('journal')->>'number');
    INSERT INTO public.journal_entries(
      entry_number,branch_id,entry_date,reference_type,reference_id,
      reference_number,description,created_by
    ) VALUES (
      v_journal_number,p_branch_id,(v_now AT TIME ZONE 'Africa/Cairo')::date,
      'approved_raw_shortage_variance',v_variance_reference,p_reference_number,
      'Frozen approved raw issue / actual receipt shortage variance '||v_receipt_ledger,
      p_created_by
    ) RETURNING id INTO v_journal;
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES(
      v_journal,v_variance_account,
      GREATEST(v_posted_variance,0),GREATEST(-v_posted_variance,0),
      'Approved shortage vs receipt cost'
    ),(
      v_journal,v_inventory_account,
      GREATEST(-v_posted_variance,0),GREATEST(v_posted_variance,0),
      'Raw warehouse inventory shortage offset'
    );
  END IF;

  SELECT COALESCE(sum(quantity),0),
    COALESCE(sum(quantity*COALESCE(unit_cost,0)),0)
    INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
  VALUES(p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET
    quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();

  RETURN jsonb_build_object(
    'success',true,'warehouse_id',p_warehouse_id,
    'before_qty',v_before,'after_qty',v_before+p_qty,
    'approved_shortage_absorbed',v_shortage_absorbed,
    'approved_price_variance_exact',v_variance,
    'approved_price_variance_posted',v_posted_variance,
    'receipt_ledger_id',v_receipt_ledger,'journal_entry_id',v_journal
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION private.stock_count_raw_price(p_branch_id uuid, p_raw_material_ids uuid[], p_as_of timestamp with time zone)
 RETURNS TABLE(raw_material_id uuid, branch_id uuid, unit_cost numeric, price_source text, priced_at timestamp with time zone, reference_number text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT p.raw_material_id,p.branch_id,COALESCE(p.unit_cost,0::numeric),
   CASE WHEN p.unit_cost IS NULL THEN 'catalog_zero' ELSE p.price_source END,
   CASE WHEN p.unit_cost IS NULL THEN rm.created_at ELSE p.priced_at END,p.reference_number
 FROM private.latest_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of) p
 JOIN public.raw_materials rm ON rm.id=p.raw_material_id AND rm.branch_id=p.branch_id;
$function$
;
CREATE OR REPLACE FUNCTION private.validate_count_legacy_quantity(p_raw uuid, p_branch uuid, p_warehouse uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
    WITH debt AS MATERIALIZED (
      SELECT oversold_batch_id,sum(debt_quantity-settled_quantity) qty
      FROM public.raw_fifo_debts WHERE raw_material_id=p_raw AND branch_id=p_branch
        AND warehouse_id=p_warehouse AND settled_quantity<debt_quantity GROUP BY oversold_batch_id
    ), negative AS MATERIALIZED (
      SELECT id,quantity FROM public.raw_material_batches WHERE raw_material_id=p_raw
        AND branch_id=p_branch AND warehouse_id=p_warehouse AND quantity<0
    ) SELECT 1 FROM negative b FULL JOIN debt d ON d.oversold_batch_id=b.id
      WHERE b.id IS NULL OR d.oversold_batch_id IS NULL OR -b.quantity IS DISTINCT FROM d.qty
  ) THEN RAISE EXCEPTION 'COUNT_LEGACY_QUANTITY_UNRECONCILED'; END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public._capture_kitchen_ingredient_prices()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_transfer_source public.order_kitchen_inventory_events%ROWTYPE;
  v_transfer_context jsonb;
  v_raw_ids uuid[];
  v_prices jsonb := '{}'::jsonb;
  v_component jsonb;
  v_price jsonb;
  v_components jsonb := '[]'::jsonb;
  v_unit_cost numeric;
  v_quantity numeric;
  v_lookup_failed boolean := false;
BEGIN
  IF NEW.transfer_origin_event_id IS NOT NULL THEN
    v_transfer_context:=public._pos_partial_transfer_context(NEW.order_id,NEW.order_item_id);
    SELECT * INTO v_transfer_source FROM public.order_kitchen_inventory_events
      WHERE id=NULLIF(current_setting('app.pos_item_transfer_snapshot_source_event',true),'')::uuid;
    IF v_transfer_context IS NULL OR v_transfer_source.id IS NULL
      OR v_transfer_source.order_id IS DISTINCT FROM NEW.order_id
      OR v_transfer_source.order_item_id IS DISTINCT FROM (v_transfer_context->>'source_item_id')::uuid
      OR NEW.order_item_id IS DISTINCT FROM (v_transfer_context->>'new_item_id')::uuid
      OR v_transfer_source.settled_sale_id IS NOT NULL OR NEW.settled_sale_id IS NOT NULL
      OR NEW.sent_quantity<=0 OR NEW.sent_quantity>v_transfer_source.sent_quantity-v_transfer_source.voided_quantity
      OR NEW.voided_quantity<>0 OR NEW.branch_id IS DISTINCT FROM v_transfer_source.branch_id
      OR NEW.warehouse_id IS DISTINCT FROM v_transfer_source.warehouse_id
      OR NEW.created_by IS DISTINCT FROM v_transfer_source.created_by OR NEW.created_at IS DISTINCT FROM v_transfer_source.created_at
      OR NEW.kitchen_send_id IS DISTINCT FROM v_transfer_source.kitchen_send_id
      OR NEW.snapshot_version IS DISTINCT FROM v_transfer_source.snapshot_version
      OR NEW.transfer_origin_event_id IS DISTINCT FROM COALESCE(v_transfer_source.transfer_origin_event_id,v_transfer_source.id)
      OR NEW.total_cost IS DISTINCT FROM round(v_transfer_source.total_cost*NEW.sent_quantity/v_transfer_source.sent_quantity,6)
      OR NEW.component_snapshot IS DISTINCT FROM public._pos_transfer_snapshot_part(v_transfer_source.component_snapshot,NEW.sent_quantity,v_transfer_source.sent_quantity)
      THEN RAISE EXCEPTION 'TRANSFER_SNAPSHOT_PROVENANCE_INVALID'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.snapshot_version < 2
     OR jsonb_typeof(NEW.component_snapshot) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.component_snapshot) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT (component->>'raw_material_id')::uuid)
    INTO v_raw_ids
  FROM jsonb_array_elements(NEW.component_snapshot) component
  WHERE component ? 'raw_material_id';

  BEGIN
    -- Bounded approved sources at this exact send time. Trigger remains paused.
    -- Do not use inventory averages, FIFO batch costs, or default-cost guesses.
    SELECT COALESCE(jsonb_object_agg(
      p.raw_material_id::text,
      jsonb_build_object('unit_cost',p.unit_cost, 'price_source',p.price_source, 'priced_at',p.priced_at)
    ), '{}'::jsonb)
    INTO v_prices
    FROM public._kitchen_approved_price_candidate(NEW.branch_id, v_raw_ids, COALESCE(NEW.created_at, now())) p
    WHERE p.unit_cost > 0
      AND p.price_source IN ('purchase','pricing','stock_count')
      AND p.priced_at IS NOT NULL
      AND p.priced_at <= COALESCE(NEW.created_at, now());
  EXCEPTION WHEN OTHERS THEN
    -- A pricing lookup failure cannot break checkout, kitchen dispatch or stock.
    -- Missing prices remain NULL, never zero and never today's retrospective price.
    v_lookup_failed := true;
    v_prices := '{}'::jsonb;
    RAISE LOG 'kitchen_price_snapshot_lookup_failed event % SQLSTATE %', NEW.id, SQLSTATE;
  END;

  FOR v_component IN SELECT value FROM jsonb_array_elements(NEW.component_snapshot)
  LOOP
    v_price := v_prices -> (v_component->>'raw_material_id');
    v_quantity := NULLIF(v_component->>'quantity','')::numeric;
    v_unit_cost := NULLIF(v_price->>'unit_cost','')::numeric;
    IF v_unit_cost IS NULL OR v_unit_cost <= 0 OR v_quantity IS NULL OR v_quantity <= 0 THEN
      v_components := v_components || jsonb_build_array(
        v_component || jsonb_build_object(
          'unit_cost',NULL,
          'extended_cost',NULL,
          'price_source',CASE WHEN v_lookup_failed THEN 'lookup_failed' ELSE 'unpriced' END,
          'priced_at',NULL,
          'price_captured_at',COALESCE(NEW.created_at,now())
        )
      );
    ELSE
      v_components := v_components || jsonb_build_array(
        v_component || jsonb_build_object(
          'unit_cost',v_unit_cost,
          'extended_cost',round(v_quantity*v_unit_cost,6),
          'price_source',v_price->>'price_source',
          'priced_at',v_price->>'priced_at',
          'price_captured_at',COALESCE(NEW.created_at,now())
        )
      );
    END IF;
  END LOOP;

  NEW.component_snapshot := v_components;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public._deduct_kitchen_raw_components(p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_quantity numeric, p_modifier_option_ids jsonb, p_event_id uuid, p_reference_number text, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_res jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_oversold jsonb := '[]'::jsonb;
  v_total_cost numeric(18,6) := 0;
  v_count integer := 0;
  v_fallback_raw_id uuid;
  v_fallback_raw_name text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_QUANTITY'
    );
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.kitchen_raw_need (
    raw_material_id uuid PRIMARY KEY,
    raw_name text,
    required_qty numeric(18,6) NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.kitchen_raw_need;

  INSERT INTO pg_temp.kitchen_raw_need(raw_material_id, raw_name, required_qty)
  SELECT
    r.raw_material_id,
    r.raw_name,
    round(r.quantity_per_sale * p_quantity, 6)
  FROM public.resolve_kitchen_item_raw_components(
    p_product_id,
    p_branch_id,
    COALESCE(p_modifier_option_ids, '[]'::jsonb)
  ) r
  ON CONFLICT(raw_material_id) DO UPDATE
  SET required_qty = pg_temp.kitchen_raw_need.required_qty + EXCLUDED.required_qty,
      raw_name = EXCLUDED.raw_name;

  SELECT count(*) INTO v_count
  FROM pg_temp.kitchen_raw_need
  WHERE abs(required_qty) > 0.000001;

  IF v_count = 0 THEN
    -- Business rule: an unconfigured sellable product is still valid.
    -- Materialize one branch-scoped fallback raw with the product name and
    -- consume it directly. Because FIFO allows debt, the resulting raw balance
    -- becomes negative when no stock exists.
    v_fallback_raw_id := public._ensure_pos_fallback_product_raw(
      p_product_id,
      p_branch_id
    );

    SELECT rm.name
    INTO v_fallback_raw_name
    FROM public.raw_materials rm
    WHERE rm.id = v_fallback_raw_id
      AND rm.branch_id = p_branch_id
      AND rm.is_active = true;

    IF v_fallback_raw_id IS NULL OR v_fallback_raw_name IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ORDER_ITEM_CONFIGURATION_INVALID',
        'detail', 'FALLBACK_RAW_CREATE_FAILED'
      );
    END IF;

    INSERT INTO pg_temp.kitchen_raw_need(
      raw_material_id,
      raw_name,
      required_qty
    ) VALUES (
      v_fallback_raw_id,
      v_fallback_raw_name,
      round(p_quantity, 6)
    );

    v_count := 1;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.kitchen_raw_need
    WHERE required_qty < -0.000001
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_MODIFIER_INVENTORY_EFFECT',
      'detail', 'Modifier removal exceeds the product raw component quantity.'
    );
  END IF;

  FOR v_row IN
    SELECT *
    FROM pg_temp.kitchen_raw_need
    WHERE required_qty > 0.000001
    ORDER BY raw_material_id
  LOOP
    v_res := public._raw_remove_fifo(
      v_row.raw_material_id,
      p_branch_id,
      p_warehouse_id,
      v_row.required_qty,
      'kitchen_send',
      'kitchen_send',
      p_event_id,
      p_reference_number,
      p_created_by,
      true
    );

    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', COALESCE(v_res->>'error', 'KITCHEN_RAW_DEDUCTION_FAILED'),
        'detail', COALESCE(v_res->>'detail', v_res::text),
        'raw_material_id', v_row.raw_material_id
      );
    END IF;

    v_total_cost := v_total_cost + COALESCE((v_res->>'total_cost')::numeric, 0);

    v_raws := v_raws || jsonb_build_object(
      'raw_material_id', v_row.raw_material_id,
      'raw_name', v_row.raw_name,
      'quantity', v_row.required_qty,
      'total_cost', COALESCE((v_res->>'total_cost')::numeric, 0)
    );

    IF COALESCE((v_res->>'oversold')::numeric, 0) > 0 THEN
      v_oversold := v_oversold || jsonb_build_object(
        'raw_material_id', v_row.raw_material_id,
        'raw_name', v_row.raw_name,
        'quantity', COALESCE((v_res->>'oversold')::numeric, 0),
        'total_cost', 0
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'raw_materials_deducted', v_raws,
    'raw_oversold', v_oversold,
    'total_cost', v_total_cost,
    'errors', '[]'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'ORDER_ITEM_CONFIGURATION_INVALID',
    'detail', SQLERRM
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public._raw_add(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_unit_cost numeric DEFAULT 0, p_batch_number text DEFAULT NULL::text, p_production_date date DEFAULT NULL::date, p_expiry_date date DEFAULT NULL::date, p_entry_type text DEFAULT 'purchase'::text, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_before numeric(14,4):=0;
  v_after numeric(14,4):=0;
  v_branch_qty numeric(14,4):=0;
  v_branch_value numeric(18,4):=0;
  v_branch_avg numeric(12,2):=0;
  v_batch_no text;
  v_batch_id uuid;
  v_ledger_id bigint;
  v_fifo jsonb;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PARAMS');
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.raw_materials
    WHERE id=p_raw_material_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','RAW_MATERIAL_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );

  SELECT COALESCE(SUM(quantity),0)
  INTO v_before
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  v_batch_no:=COALESCE(
    NULLIF(btrim(COALESCE(p_batch_number,'')),''),
    'RB-'||substr(replace(gen_random_uuid()::text,'-',''),1,10)
  );

  INSERT INTO public.raw_material_batches(
    raw_material_id,branch_id,warehouse_id,batch_number,
    quantity,unit_cost,production_date,expiry_date,source_type,source_id
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,
    p_qty,COALESCE(p_unit_cost,0),p_production_date,p_expiry_date,
    COALESCE(p_reference_type,p_entry_type),p_reference_id
  )
  RETURNING id INTO v_batch_id;

  v_after:=v_before+p_qty;

  INSERT INTO public.inventory_ledger(
    raw_material_id,branch_id,warehouse_id,batch_number,
    quantity,unit_cost,total_cost,before_qty,after_qty,
    entry_type,reference_type,reference_id,reference_number,created_by
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,
    p_qty,COALESCE(p_unit_cost,0),p_qty*COALESCE(p_unit_cost,0),
    v_before,v_after,p_entry_type,p_reference_type,p_reference_id,
    p_reference_number,p_created_by
  )
  RETURNING id INTO v_ledger_id;

  v_fifo:=public._raw_fifo_settle_receipt(
    v_ledger_id,
    v_batch_id,
    NULL
  );

  IF COALESCE((v_fifo->>'success')::boolean,false) IS NOT TRUE THEN
    RETURN v_fifo;
  END IF;

  SELECT
    COALESCE(SUM(quantity),0),
    COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0)
  INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id;

  v_branch_avg:=CASE
    WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2)
    ELSE 0
  END;

  INSERT INTO public.raw_material_inventory(
    raw_material_id,branch_id,quantity,avg_cost
  ) VALUES (
    p_raw_material_id,p_branch_id,v_branch_qty,v_branch_avg
  )
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE
  SET quantity=EXCLUDED.quantity,
      avg_cost=EXCLUDED.avg_cost,
      updated_at=now();

  RETURN jsonb_build_object(
    'success',true,
    'before_qty',v_before,
    'after_qty',v_after,
    'avg_cost',v_branch_avg,
    'batch_number',v_batch_no,
    'warehouse_id',p_warehouse_id,
    'fifo_settled_quantity',COALESCE((v_fifo->>'settled_quantity')::numeric,0),
    'fifo_settled_value',COALESCE((v_fifo->>'settled_value')::numeric,0)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt(p_receipt_ledger_id bigint, p_receipt_batch_id uuid, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_receipt public.inventory_ledger%ROWTYPE;
  v_batch public.raw_material_batches%ROWTYPE;
  v_debt record;
  v_source public.inventory_ledger%ROWTYPE;
  v_estimate public.raw_fifo_debt_price_estimates%ROWTYPE;
  v_take numeric(18,6);
  v_available numeric(18,6);
  v_actual_value numeric(18,6);
  v_estimate_take numeric(18,6);
  v_estimate_value numeric(18,6);
  v_delta numeric(18,6);
  v_new_total numeric(18,6);
  v_settlement_id uuid;
  v_res jsonb;
  v_had_estimate boolean;
  v_total_settled numeric(18,6):=0;
  v_count_cutoff timestamptz;
  v_total_value numeric(18,6):=0;
  v_total_adjustment numeric(18,6):=0;
BEGIN
  SELECT * INTO v_receipt
  FROM public.inventory_ledger
  WHERE id=p_receipt_ledger_id
    AND raw_material_id IS NOT NULL
    AND quantity>0
  FOR SHARE;

  SELECT * INTO v_batch
  FROM public.raw_material_batches
  WHERE id=p_receipt_batch_id
  FOR UPDATE;

  IF v_receipt.id IS NULL OR v_batch.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_RECEIPT_NOT_FOUND');
  END IF;

  IF v_batch.raw_material_id<>v_receipt.raw_material_id
     OR v_batch.branch_id<>v_receipt.branch_id
     OR v_batch.warehouse_id IS DISTINCT FROM v_receipt.warehouse_id THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_RECEIPT_BATCH_MISMATCH');
  END IF;

  v_available:=LEAST(v_receipt.quantity,GREATEST(v_batch.quantity,0));

  -- An applied physical count freezes the cost of the consumption it covers,
  -- even while quantity-only legacy cleanup is being drained in small batches.
  SELECT max(c.created_at) INTO v_count_cutoff
  FROM public.stock_count_items i JOIN public.stock_counts c ON c.id=i.stock_count_id
  WHERE i.raw_material_id=v_receipt.raw_material_id AND c.branch_id=v_receipt.branch_id
    AND c.warehouse_id=v_receipt.warehouse_id AND c.status='applied' AND c.created_at<=v_receipt.created_at;


  FOR v_debt IN
    SELECT d.*
    FROM public.raw_fifo_debts d
    WHERE d.raw_material_id=v_receipt.raw_material_id
      AND d.branch_id=v_receipt.branch_id
      AND d.warehouse_id=v_receipt.warehouse_id
      AND d.source_created_at<=v_receipt.created_at
      AND d.settled_quantity<d.debt_quantity
    ORDER BY d.source_created_at,d.source_ledger_id
    FOR UPDATE
  LOOP
    EXIT WHEN v_available<=0;

    v_take:=LEAST(v_available,v_debt.debt_quantity-v_debt.settled_quantity);
    IF v_take<=0 THEN CONTINUE; END IF;

    INSERT INTO public.raw_fifo_settlements(
      debt_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,run_id
    ) VALUES (
      v_debt.id,v_receipt.id,v_batch.id,v_take,
      COALESCE(v_receipt.unit_cost,0),
      v_take*COALESCE(v_receipt.unit_cost,0),
      p_run_id
    )
    ON CONFLICT (debt_id,receipt_ledger_id) DO NOTHING
    RETURNING id INTO v_settlement_id;

    IF v_settlement_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_source
    FROM public.inventory_ledger
    WHERE id=v_debt.source_ledger_id
    FOR UPDATE;

    IF v_source.id IS NULL OR v_source.quantity>=0 THEN
      UPDATE public.raw_fifo_settlements
      SET reconciliation_status='error',
          reconciliation_error='FIFO_SOURCE_LEDGER_INVALID'
      WHERE id=v_settlement_id;
      CONTINUE;
    END IF;

    IF v_source.approved_cost_basis='approved_last_known'
       OR (v_count_cutoff IS NOT NULL AND v_source.created_at<=v_count_cutoff) THEN
      -- New approved-price movements keep their original valuation forever.
      v_actual_value:=0; v_delta:=0; v_new_total:=v_source.total_cost;
      UPDATE public.raw_fifo_settlements SET unit_cost=0,total_cost=0 WHERE id=v_settlement_id;
      UPDATE public.raw_fifo_debt_price_estimates
        SET zero_cost_finalized_quantity=zero_cost_finalized_quantity+least(v_take,remaining_estimated_quantity),
            remaining_estimated_quantity=greatest(remaining_estimated_quantity-v_take,0),updated_at=clock_timestamp()
        WHERE debt_id=v_debt.id AND remaining_estimated_quantity>0;
    ELSE
    v_had_estimate:=false;
    v_estimate_take:=0;
    v_estimate_value:=0;
    v_actual_value:=v_take*COALESCE(v_receipt.unit_cost,0);
    v_delta:=v_actual_value;

    SELECT * INTO v_estimate
    FROM public.raw_fifo_debt_price_estimates
    WHERE debt_id=v_debt.id
    FOR UPDATE;

    IF v_estimate.debt_id IS NOT NULL
       AND v_estimate.remaining_estimated_quantity>0 THEN
      v_had_estimate:=true;
      v_estimate_take:=LEAST(v_take,v_estimate.remaining_estimated_quantity);
      v_estimate_value:=v_estimate_take*v_estimate.estimated_unit_cost;

      IF COALESCE(v_receipt.unit_cost,0)>0 THEN
        -- Actual receipt replaces the provisional basis only by the difference.
        v_delta:=v_actual_value-v_estimate_value;
        UPDATE public.raw_fifo_debt_price_estimates
        SET remaining_estimated_quantity=GREATEST(remaining_estimated_quantity-v_estimate_take,0),
            replaced_quantity=replaced_quantity+v_estimate_take,
            updated_at=now()
        WHERE debt_id=v_debt.id;
      ELSE
        -- A zero-cost receipt is not a stronger valuation source; preserve fallback cost.
        v_delta:=0;
        UPDATE public.raw_fifo_debt_price_estimates
        SET remaining_estimated_quantity=GREATEST(remaining_estimated_quantity-v_estimate_take,0),
            zero_cost_finalized_quantity=zero_cost_finalized_quantity+v_estimate_take,
            updated_at=now()
        WHERE debt_id=v_debt.id;
      END IF;
    END IF;

    v_new_total:=COALESCE(v_source.total_cost,0)-v_delta;
    IF v_new_total>0.005 THEN
      RAISE EXCEPTION
        'FIFO_PRICE_FALLBACK_SETTLEMENT_NEGATIVE_COST ledger=% current=% delta=%',
        v_source.id,v_source.total_cost,v_delta;
    END IF;

    END IF;

    UPDATE public.raw_fifo_debts
    SET settled_quantity=settled_quantity+v_take,
        updated_at=now()
    WHERE id=v_debt.id;

    IF v_debt.oversold_batch_id IS NOT NULL THEN
      UPDATE public.raw_material_batches
      SET quantity=LEAST(quantity+v_take,0)
      WHERE id=v_debt.oversold_batch_id;
    END IF;

    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_take,0)
    WHERE id=v_batch.id;

    IF v_source.approved_cost_basis IS DISTINCT FROM 'approved_last_known'
       AND NOT (v_count_cutoff IS NOT NULL AND v_source.created_at<=v_count_cutoff) THEN
    UPDATE public.inventory_ledger
    SET total_cost=v_new_total,
        unit_cost=CASE
          WHEN quantity<0 THEN abs(v_new_total/quantity)
          ELSE unit_cost
        END
    WHERE id=v_source.id;

    END IF;

    IF abs(v_delta)>0.000001 THEN
      v_res:=public._fifo_adjust_reference_delta(
        v_source.reference_type,
        v_source.reference_id,
        v_source.branch_id,
        v_source.warehouse_id,
        'raw_material',
        v_source.raw_material_id,
        v_delta,
        0
      );

      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        IF v_had_estimate THEN
          RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REFERENCE_RECONCILIATION_FAILED ledger=% detail=%',
            v_source.id,v_res;
        END IF;

        UPDATE public.raw_fifo_settlements
        SET reconciliation_status='error',
            reconciliation_error=COALESCE(v_res->>'error','FIFO_REFERENCE_RECONCILIATION_FAILED')
        WHERE id=v_settlement_id;
      END IF;
    END IF;

    v_available:=v_available-v_take;
    v_total_settled:=v_total_settled+v_take;
    v_total_value:=v_total_value+v_actual_value;
    v_total_adjustment:=v_total_adjustment+v_delta;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,
    'settled_value',v_total_value,
    'cost_adjustment',v_total_adjustment,
    'remaining_receipt_quantity',v_available
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public._raw_remove_fifo(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_entry_type text DEFAULT 'production'::text, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_allow_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_running numeric(14,4):=0;
  v_branch_qty numeric(14,4):=0;
  v_branch_value numeric(18,4):=0;
  v_total_cost numeric(18,4):=0;
  v_total_removed numeric(14,4):=0;
  v_oversold numeric(14,4):=0;
  v_debt_batch text;
  v_debt_batch_id uuid;
  v_oversold_ledger_id bigint;
  v_oversold_created_at timestamptz;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN
    RETURN jsonb_build_object(
      'success',true,'shortage',0,'removed',0,'total_cost',0,'avg_cost',0
    );
  END IF;

  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_REQUIRED');
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );

  SELECT COALESCE(SUM(quantity),0)
  INTO v_running
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  v_remaining:=p_qty;

  FOR v_batch IN
    SELECT id,quantity,unit_cost,batch_number
    FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id
      AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id
      AND quantity>0
    ORDER BY expiry_date NULLS LAST,created_at,id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_deduct:=LEAST(v_batch.quantity,v_remaining);

    UPDATE public.raw_material_batches
    SET quantity=quantity-v_deduct
    WHERE id=v_batch.id;

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,
      -v_deduct,COALESCE(v_batch.unit_cost,0),
      -v_deduct*COALESCE(v_batch.unit_cost,0),
      v_running,v_running-v_deduct,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    );

    v_running:=v_running-v_deduct;
    v_remaining:=v_remaining-v_deduct;
    v_total_removed:=v_total_removed+v_deduct;
    v_total_cost:=v_total_cost+v_deduct*COALESCE(v_batch.unit_cost,0);
  END LOOP;

  IF v_remaining>0 AND p_allow_negative THEN
    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    INSERT INTO public.raw_material_batches(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,production_date,expiry_date,source_type,source_id
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_remaining,0,NULL,NULL,
      COALESCE(NULLIF(p_reference_type,''),p_entry_type)||'_oversold',
      p_reference_id
    )
    RETURNING id INTO v_debt_batch_id;

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_remaining,0,0,v_running,v_running-v_remaining,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    )
    RETURNING id,created_at INTO v_oversold_ledger_id,v_oversold_created_at;

    INSERT INTO public.raw_fifo_debts(
      source_ledger_id,raw_material_id,branch_id,warehouse_id,
      oversold_batch_id,reference_type,reference_id,reference_number,
      debt_quantity,settled_quantity,source_created_at
    ) VALUES (
      v_oversold_ledger_id,p_raw_material_id,p_branch_id,p_warehouse_id,
      v_debt_batch_id,p_reference_type,p_reference_id,p_reference_number,
      v_remaining,0,v_oversold_created_at
    )
    ON CONFLICT (source_ledger_id) DO NOTHING;

    v_running:=v_running-v_remaining;
    v_oversold:=v_remaining;
    v_remaining:=0;
  END IF;

  SELECT
    COALESCE(SUM(quantity),0),
    COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0)
  INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id;

  INSERT INTO public.raw_material_inventory(
    raw_material_id,branch_id,quantity,avg_cost
  ) VALUES (
    p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END
  )
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE
  SET quantity=EXCLUDED.quantity,
      avg_cost=EXCLUDED.avg_cost,
      updated_at=now();

  RETURN jsonb_build_object(
    'success',true,
    'shortage',v_remaining,
    'removed',v_total_removed,
    'total_cost',v_total_cost,
    'avg_cost',CASE
      WHEN v_total_removed>0 THEN round(v_total_cost/v_total_removed,2)
      ELSE 0
    END,
    'warehouse_id',p_warehouse_id,
    'oversold',v_oversold,
    'debt_batch_number',v_debt_batch,
    'fifo_debt_ledger_id',v_oversold_ledger_id
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_current_raw_material_valuation(p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT (
    public.can_permission('reports.costing')
    OR public.can_permission('reports.financial')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:reports.costing';
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;

  RETURN (
    WITH current_prices AS MATERIALIZED (
      SELECT * FROM public.get_raw_material_current_prices(p_branch_id)
    ), batches AS (
      SELECT
        b.raw_material_id,
        COALESCE(SUM(b.quantity),0) AS current_qty,
        COALESCE(SUM(b.quantity*COALESCE(b.unit_cost,0)),0) AS current_value,
        COUNT(*) FILTER (WHERE b.quantity<>0) AS open_batches
      FROM public.raw_material_batches b
      WHERE b.branch_id=p_branch_id
      GROUP BY b.raw_material_id
    ),
    debt_by_warehouse AS (
      SELECT
        d.raw_material_id,
        d.warehouse_id,
        SUM(GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0))::numeric AS outstanding_qty,
        COUNT(*) FILTER (
          WHERE GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0)>0.0001
        )::bigint AS outstanding_rows,
        MIN(d.source_created_at) FILTER (
          WHERE GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0)>0.0001
        ) AS oldest_debt_at
      FROM public.raw_fifo_debts d
      WHERE d.branch_id=p_branch_id
      GROUP BY d.raw_material_id,d.warehouse_id
      HAVING SUM(GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0))>0.0001
    ),
    purchase_receipts AS (
      SELECT
        il.raw_material_id,
        il.warehouse_id,
        MAX(il.created_at) AS last_purchase_receipt_at
      FROM public.inventory_ledger il
      WHERE il.branch_id=p_branch_id
        AND il.raw_material_id IS NOT NULL
        AND il.warehouse_id IS NOT NULL
        AND il.quantity>0
        AND (
          COALESCE(il.entry_type,'') IN ('purchase','purchase_receipt')
          OR COALESCE(il.reference_type,'') IN ('purchase','purchase_receipt')
        )
      GROUP BY il.raw_material_id,il.warehouse_id
    ),
    debt_priced AS (
      SELECT
        d.raw_material_id,
        d.warehouse_id,
        d.outstanding_qty,
        d.outstanding_rows,
        d.oldest_debt_at,
        pr.last_purchase_receipt_at,
        COALESCE(cp.unit_cost,0)::numeric AS known_cost
      FROM debt_by_warehouse d
      LEFT JOIN current_prices cp
        ON cp.raw_material_id=d.raw_material_id AND cp.branch_id=p_branch_id
      LEFT JOIN purchase_receipts pr
        ON pr.raw_material_id=d.raw_material_id
       AND pr.warehouse_id=d.warehouse_id
    ),
    debt AS (
      SELECT
        dp.raw_material_id,
        SUM(dp.outstanding_qty)::numeric AS outstanding_qty,
        SUM(dp.outstanding_rows)::bigint AS outstanding_rows,
        MIN(dp.oldest_debt_at) AS oldest_debt_at,
        MAX(dp.last_purchase_receipt_at) AS last_purchase_receipt_at,
        COUNT(*)::bigint AS debt_warehouse_count,
        COUNT(*) FILTER (
          WHERE dp.last_purchase_receipt_at IS NULL
        )::bigint AS warehouses_without_receipt_history,
        SUM(CASE
          WHEN COALESCE(dp.known_cost,0)>0 THEN dp.outstanding_qty
          ELSE 0
        END)::numeric AS priced_debt_qty,
        SUM(CASE
          WHEN COALESCE(dp.known_cost,0)<=0 THEN dp.outstanding_qty
          ELSE 0
        END)::numeric AS unpriced_debt_qty,
        SUM(
          CASE
            WHEN COALESCE(dp.known_cost,0)>0
              THEN dp.outstanding_qty*dp.known_cost
            ELSE 0
          END
        )::numeric AS estimated_debt_value
      FROM debt_priced dp
      GROUP BY dp.raw_material_id
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'raw_material_id',rm.id,
        'raw_material_name',rm.name,
        'raw_material_code',rm.code,
        'unit_name',COALESCE(u.name,''),
        'current_quantity',round(COALESCE(b.current_qty,0),4),
        'fifo_current_unit_cost',round(
          CASE
            WHEN COALESCE(b.current_qty,0)<>0
              THEN COALESCE(b.current_value,0)/NULLIF(b.current_qty,0)
            ELSE 0
          END,
          6
        ),
        'current_inventory_value',round(COALESCE(b.current_value,0),2),
        'latest_authoritative_cost',round(COALESCE(price.unit_cost,0),6),
        'price_source',COALESCE(price.price_source,'unpriced'),
        'priced_at',to_jsonb(price.priced_at) #>> '{}',
        'open_fifo_batches',COALESCE(b.open_batches,0),
        'outstanding_fifo_debt_quantity',round(COALESCE(d.outstanding_qty,0),4),
        'outstanding_fifo_debt_rows',COALESCE(d.outstanding_rows,0),
        'oldest_outstanding_debt_at',d.oldest_debt_at,
        'last_purchase_receipt_at',d.last_purchase_receipt_at,
        'fifo_debt_warehouse_count',COALESCE(d.debt_warehouse_count,0),
        'fifo_debt_warehouses_without_receipt_history',COALESCE(d.warehouses_without_receipt_history,0),
        'unpriced_fifo_debt_quantity',round(COALESCE(d.unpriced_debt_qty,0),4),
        'fifo_debt_estimated_unit_cost',round(
          CASE
            WHEN COALESCE(d.priced_debt_qty,0)>0
              THEN COALESCE(d.estimated_debt_value,0)/NULLIF(d.priced_debt_qty,0)
            ELSE 0
          END,
          6
        ),
        'estimated_fifo_debt_value',round(COALESCE(d.estimated_debt_value,0),2),
        'fifo_debt_pricing_coverage_pct',round(
          CASE
            WHEN COALESCE(d.outstanding_qty,0)>0
              THEN COALESCE(d.priced_debt_qty,0)*100.0/NULLIF(d.outstanding_qty,0)
            ELSE 100
          END,
          2
        ),
        'has_unpriced_fifo_debt',COALESCE(d.unpriced_debt_qty,0)>0.0001,
        'has_missing_purchase_receipt_history',COALESCE(d.warehouses_without_receipt_history,0)>0,
        'fifo_debt_status',
          CASE
            WHEN COALESCE(d.outstanding_qty,0)<=0.0001 THEN 'OK'
            WHEN COALESCE(d.unpriced_debt_qty,0)>0.0001
              AND COALESCE(d.warehouses_without_receipt_history,0)>0
              THEN 'UNPRICED_NO_RECEIPT'
            WHEN COALESCE(d.unpriced_debt_qty,0)>0.0001 THEN 'UNPRICED'
            WHEN COALESCE(d.warehouses_without_receipt_history,0)>0
              THEN 'NO_RECEIPT_HISTORY'
            ELSE 'OUTSTANDING'
          END
      )
      ORDER BY rm.name
    ),'[]'::jsonb)
    FROM public.raw_materials rm
    LEFT JOIN public.units u ON u.id=rm.unit_id
    LEFT JOIN batches b ON b.raw_material_id=rm.id
    LEFT JOIN debt d ON d.raw_material_id=rm.id
    LEFT JOIN current_prices price
      ON price.raw_material_id=rm.id AND price.branch_id=rm.branch_id
    WHERE rm.branch_id=p_branch_id
      AND (
        rm.is_active
        OR COALESCE(b.current_qty,0)<>0
        OR COALESCE(d.outstanding_qty,0)>0.0001
      )
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.raw_fifo_apply_backfill(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.raw_fifo_backfill_runs%ROWTYPE;
  v_latest bigint;
  v_changed integer;
  v_batch_changed integer;
  v_row record;
  v_debt_id uuid;
  v_batch_id uuid;
  v_res jsonb;
  v_existing_debt public.raw_fifo_debts%ROWTYPE;
  v_settlement_mismatch integer;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_backfill_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_BACKFILL_RUN_NOT_FOUND');
  END IF;

  IF v_run.status='applied' THEN
    RETURN jsonb_build_object('success',true,'already_applied',true,'run_id',v_run.id);
  END IF;

  IF v_run.status<>'prepared' THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_BACKFILL_NOT_PREPARED','status',v_run.status
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('raw-fifo-backfill:'||COALESCE(v_run.branch_id::text,'all'),0)
  );

  FOR v_row IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_fifo_backfill_plan
    WHERE run_id=p_run_id
    ORDER BY branch_id,raw_material_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)
    );
  END LOOP;

  SELECT COALESCE(max(id),0) INTO v_latest
  FROM public.inventory_ledger
  WHERE raw_material_id IS NOT NULL
    AND warehouse_id IS NOT NULL
    AND (v_run.branch_id IS NULL OR branch_id=v_run.branch_id);

  IF v_latest<>v_run.cutoff_ledger_id THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_STALE_PLAN',
      'prepared_cutoff',v_run.cutoff_ledger_id,
      'current_cutoff',v_latest
    );
  END IF;

  SELECT count(*) INTO v_batch_changed
  FROM public.raw_fifo_backfill_batch_plan bp
  JOIN public.raw_material_batches b ON b.id=bp.batch_id
  WHERE bp.run_id=p_run_id
    AND abs(b.quantity-bp.current_quantity)>0.0001;

  IF v_batch_changed>0 THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_BATCHES_CHANGED',
      'changed_batches',v_batch_changed
    );
  END IF;

  SELECT count(*) INTO v_changed
  FROM public.raw_fifo_backfill_plan p
  WHERE p.run_id=p_run_id
    AND abs(p.target_cost-p.current_cost)>0.005
    AND (
      p.reference_id IS NULL
      OR COALESCE(p.reference_type,'') NOT IN (
        'sale','kitchen_send','production','purchase_return','warehouse_transfer'
      )
    );

  IF v_changed>0 THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_UNSUPPORTED_REFERENCE',
      'rows',v_changed
    );
  END IF;

  UPDATE public.raw_fifo_backfill_runs
  SET status='applying'
  WHERE id=p_run_id;

  -- Rebase only audited, fully-settled historical debt rows whose current
  -- receipt-allocation map differs from this replay. This is valuation-neutral:
  -- source-reference cost deltas are still applied below from current_cost to target_cost.
  v_res:=public._raw_fifo_rebase_historical_debt_state(p_run_id);
  IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FIFO_BACKFILL_DEBT_REBASE_FAILED detail=%',v_res;
  END IF;

  -- Materialize historical debt identity and settlement audit first.
  FOR v_row IN
    SELECT p.*,il.batch_number
    FROM public.raw_fifo_backfill_plan p
    JOIN public.inventory_ledger il ON il.id=p.consumption_ledger_id
    WHERE p.run_id=p_run_id AND p.debt_quantity>0
    ORDER BY p.source_created_at,p.consumption_ledger_id
  LOOP
    SELECT b.id INTO v_batch_id
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=v_row.raw_material_id
      AND b.branch_id=v_row.branch_id
      AND b.warehouse_id=v_row.warehouse_id
      AND b.batch_number IS NOT DISTINCT FROM v_row.batch_number
    ORDER BY b.created_at,b.id
    LIMIT 1;

    v_debt_id:=NULL;

    INSERT INTO public.raw_fifo_debts(
      source_ledger_id,raw_material_id,branch_id,warehouse_id,
      oversold_batch_id,reference_type,reference_id,reference_number,
      debt_quantity,settled_quantity,source_created_at,backfill_run_id
    ) VALUES (
      v_row.consumption_ledger_id,v_row.raw_material_id,v_row.branch_id,v_row.warehouse_id,
      v_batch_id,
      v_row.reference_type,v_row.reference_id,v_row.reference_number,
      v_row.debt_quantity,v_row.debt_quantity-v_row.unresolved_quantity,v_row.source_created_at,
      p_run_id
    )
    ON CONFLICT(source_ledger_id) DO NOTHING
    RETURNING id INTO v_debt_id;

    IF v_debt_id IS NULL THEN
      SELECT * INTO v_existing_debt
      FROM public.raw_fifo_debts
      WHERE source_ledger_id=v_row.consumption_ledger_id
      FOR UPDATE;

      IF v_existing_debt.id IS NULL THEN
        RAISE EXCEPTION 'FIFO_BACKFILL_EXISTING_DEBT_NOT_FOUND ledger=%',
          v_row.consumption_ledger_id;
      END IF;

      IF v_existing_debt.raw_material_id IS DISTINCT FROM v_row.raw_material_id
         OR v_existing_debt.branch_id IS DISTINCT FROM v_row.branch_id
         OR v_existing_debt.warehouse_id IS DISTINCT FROM v_row.warehouse_id
         OR abs(v_existing_debt.debt_quantity-v_row.debt_quantity)>0.000001
         OR abs(
           v_existing_debt.settled_quantity
           -(v_row.debt_quantity-v_row.unresolved_quantity)
         )>0.000001 THEN
        RAISE EXCEPTION
          'FIFO_BACKFILL_EXISTING_DEBT_MISMATCH ledger=% current_debt=% target_debt=% current_settled=% target_settled=%',
          v_row.consumption_ledger_id,
          v_existing_debt.debt_quantity,
          v_row.debt_quantity,
          v_existing_debt.settled_quantity,
          v_row.debt_quantity-v_row.unresolved_quantity;
      END IF;

      v_debt_id:=v_existing_debt.id;
    END IF;

    SELECT count(*) INTO v_settlement_mismatch
    FROM public.raw_fifo_backfill_allocations a
    JOIN public.inventory_ledger r ON r.id=a.receipt_ledger_id
    JOIN public.raw_material_batches b
      ON b.raw_material_id=r.raw_material_id
     AND b.branch_id=r.branch_id
     AND b.warehouse_id=r.warehouse_id
     AND b.batch_number IS NOT DISTINCT FROM r.batch_number
    JOIN public.raw_fifo_settlements s
      ON s.debt_id=v_debt_id
     AND s.receipt_ledger_id=a.receipt_ledger_id
    WHERE a.run_id=p_run_id
      AND a.consumption_ledger_id=v_row.consumption_ledger_id
      AND a.allocation_type='debt_settlement'
      AND (
        abs(s.quantity-a.quantity)>0.000001
        OR abs(s.unit_cost-a.unit_cost)>0.000001
        OR abs(s.total_cost-a.total_cost)>0.000001
        OR s.receipt_batch_id IS DISTINCT FROM b.id
      );

    IF v_settlement_mismatch>0 THEN
      RAISE EXCEPTION
        'FIFO_BACKFILL_EXISTING_SETTLEMENT_MISMATCH ledger=% count=%',
        v_row.consumption_ledger_id,v_settlement_mismatch;
    END IF;

    INSERT INTO public.raw_fifo_settlements(
      debt_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,run_id
    )
    SELECT
      v_debt_id,a.receipt_ledger_id,b.id,
      a.quantity,a.unit_cost,a.total_cost,p_run_id
    FROM public.raw_fifo_backfill_allocations a
    JOIN public.inventory_ledger r ON r.id=a.receipt_ledger_id
    JOIN public.raw_material_batches b
      ON b.raw_material_id=r.raw_material_id
     AND b.branch_id=r.branch_id
     AND b.warehouse_id=r.warehouse_id
     AND b.batch_number IS NOT DISTINCT FROM r.batch_number
    WHERE a.run_id=p_run_id
      AND a.consumption_ledger_id=v_row.consumption_ledger_id
      AND a.allocation_type='debt_settlement'
    ON CONFLICT(debt_id,receipt_ledger_id) DO NOTHING;
  END LOOP;

  -- Apply signed valuation deltas to source references in source chronological order.
  FOR v_row IN
    SELECT p.*
    FROM public.raw_fifo_backfill_plan p
    WHERE p.run_id=p_run_id
      AND abs(p.target_cost-p.current_cost)>0.005
    ORDER BY p.source_created_at,p.consumption_ledger_id
  LOOP
    v_res:=public._fifo_adjust_reference_delta(
      v_row.reference_type,v_row.reference_id,
      v_row.branch_id,v_row.warehouse_id,
      'raw_material',v_row.raw_material_id,
      v_row.target_cost-v_row.current_cost,
      0
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'FIFO_BACKFILL_REFERENCE_FAILED ledger=% detail=%',
        v_row.consumption_ledger_id,v_res;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=-v_row.target_cost,
        unit_cost=CASE
          WHEN v_row.quantity>0 THEN v_row.target_cost/v_row.quantity
          ELSE 0
        END
    WHERE id=v_row.consumption_ledger_id;
  END LOOP;

  -- Normalize historical per-batch residuals without changing aggregate stock.
  UPDATE public.raw_material_batches b
  SET quantity=bp.target_quantity
  FROM public.raw_fifo_backfill_batch_plan bp
  WHERE bp.run_id=p_run_id AND bp.batch_id=b.id;

  -- Refresh branch aggregate cache from canonical batches.
  FOR v_row IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_fifo_backfill_batch_plan
    WHERE run_id=p_run_id
  LOOP
    INSERT INTO public.raw_material_inventory(
      raw_material_id,branch_id,quantity,avg_cost
    )
    SELECT
      v_row.raw_material_id,v_row.branch_id,
      COALESCE(sum(b.quantity),0),
      CASE
        WHEN COALESCE(sum(b.quantity),0)>0 THEN
          round(
            COALESCE(sum(b.quantity*COALESCE(b.unit_cost,0)),0)
            / sum(b.quantity),
            2
          )
        ELSE 0
      END
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=v_row.raw_material_id
      AND b.branch_id=v_row.branch_id
    ON CONFLICT(raw_material_id,branch_id) DO UPDATE
    SET quantity=EXCLUDED.quantity,
        avg_cost=EXCLUDED.avg_cost,
        updated_at=now();
  END LOOP;

  UPDATE public.raw_fifo_backfill_runs
  SET status='applied',applied_at=now()
  WHERE id=p_run_id;

  RETURN jsonb_build_object(
    'success',true,
    'run_id',p_run_id,
    'summary',v_run.summary
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_backfill_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.raw_fifo_prepare_backfill(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run uuid:=gen_random_uuid();
  v_cutoff bigint;
  e record;
  v_debt record;
  v_lot record;
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_batch_id uuid;
  v_expiry date;
  v_unknown integer;
  v_batch_mismatch integer;
  v_summary jsonb;
BEGIN
  SELECT COALESCE(max(id),0) INTO v_cutoff
  FROM public.inventory_ledger
  WHERE raw_material_id IS NOT NULL
    AND warehouse_id IS NOT NULL
    AND (p_branch_id IS NULL OR branch_id=p_branch_id);

  INSERT INTO public.raw_fifo_backfill_runs(id,branch_id,cutoff_ledger_id,status)
  VALUES(v_run,p_branch_id,v_cutoff,'preparing');

  DROP TABLE IF EXISTS pg_temp.rf_lots;
  DROP TABLE IF EXISTS pg_temp.rf_debts;

  CREATE TEMP TABLE rf_lots(
    id bigserial PRIMARY KEY,
    raw_material_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    receipt_ledger_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    available_qty numeric(18,6) NOT NULL,
    unit_cost numeric(18,6) NOT NULL,
    expiry_date date,
    event_at timestamptz NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE rf_debts(
    id bigserial PRIMARY KEY,
    raw_material_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    consumption_ledger_id bigint NOT NULL,
    oversold_batch_id uuid,
    debt_quantity numeric(18,6) NOT NULL,
    remaining_qty numeric(18,6) NOT NULL,
    event_at timestamptz NOT NULL
  ) ON COMMIT DROP;

  FOR e IN
    SELECT il.*
    FROM public.inventory_ledger il
    WHERE il.raw_material_id IS NOT NULL
      AND il.warehouse_id IS NOT NULL
      AND il.quantity<>0
      AND il.id<=v_cutoff
      AND (p_branch_id IS NULL OR il.branch_id=p_branch_id)
    ORDER BY il.raw_material_id,il.branch_id,il.warehouse_id,il.created_at,il.id
  LOOP
    SELECT b.id,b.expiry_date
    INTO v_batch_id,v_expiry
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=e.raw_material_id
      AND b.branch_id=e.branch_id
      AND b.warehouse_id=e.warehouse_id
      AND b.batch_number IS NOT DISTINCT FROM e.batch_number
    ORDER BY b.created_at,b.id
    LIMIT 1;

    IF v_batch_id IS NULL THEN
      RAISE EXCEPTION 'FIFO_BACKFILL_BATCH_NOT_FOUND ledger=%',e.id;
    END IF;

    IF e.quantity>0 THEN
      v_remaining:=e.quantity;

      FOR v_debt IN
        SELECT *
        FROM rf_debts
        WHERE raw_material_id=e.raw_material_id
          AND branch_id=e.branch_id
          AND warehouse_id=e.warehouse_id
          AND remaining_qty>0
        ORDER BY event_at,id
      LOOP
        EXIT WHEN v_remaining<=0;
        v_take:=LEAST(v_remaining,v_debt.remaining_qty);

        UPDATE public.raw_fifo_backfill_plan
        SET target_cost=target_cost+v_take*COALESCE(e.unit_cost,0),
            unresolved_quantity=GREATEST(unresolved_quantity-v_take,0)
        WHERE run_id=v_run
          AND consumption_ledger_id=v_debt.consumption_ledger_id;

        INSERT INTO public.raw_fifo_backfill_allocations(
          run_id,consumption_ledger_id,receipt_ledger_id,
          allocation_type,quantity,unit_cost,total_cost
        ) VALUES (
          v_run,v_debt.consumption_ledger_id,e.id,
          'debt_settlement',v_take,COALESCE(e.unit_cost,0),
          v_take*COALESCE(e.unit_cost,0)
        );

        UPDATE rf_debts
        SET remaining_qty=remaining_qty-v_take
        WHERE id=v_debt.id;

        v_remaining:=v_remaining-v_take;
      END LOOP;

      IF v_remaining>0 THEN
        INSERT INTO rf_lots(
          raw_material_id,branch_id,warehouse_id,receipt_ledger_id,batch_id,
          available_qty,unit_cost,expiry_date,event_at
        ) VALUES (
          e.raw_material_id,e.branch_id,e.warehouse_id,e.id,v_batch_id,
          v_remaining,COALESCE(e.unit_cost,0),v_expiry,e.created_at
        );
      END IF;
    ELSE
      v_remaining:=-e.quantity;

      INSERT INTO public.raw_fifo_backfill_plan(
        run_id,consumption_ledger_id,raw_material_id,branch_id,warehouse_id,
        reference_type,reference_id,reference_number,entry_type,quantity,
        current_cost,target_cost,debt_quantity,unresolved_quantity,source_created_at
      ) VALUES (
        v_run,e.id,e.raw_material_id,e.branch_id,e.warehouse_id,
        e.reference_type,e.reference_id,e.reference_number,e.entry_type,
        -e.quantity,GREATEST(-COALESCE(e.total_cost,0),0),0,0,0,e.created_at
      );

      FOR v_lot IN
        SELECT *
        FROM rf_lots
        WHERE raw_material_id=e.raw_material_id
          AND branch_id=e.branch_id
          AND warehouse_id=e.warehouse_id
          AND available_qty>0
        ORDER BY expiry_date NULLS LAST,event_at,receipt_ledger_id,id
      LOOP
        EXIT WHEN v_remaining<=0;
        v_take:=LEAST(v_remaining,v_lot.available_qty);

        UPDATE public.raw_fifo_backfill_plan
        SET target_cost=target_cost+v_take*v_lot.unit_cost
        WHERE run_id=v_run AND consumption_ledger_id=e.id;

        INSERT INTO public.raw_fifo_backfill_allocations(
          run_id,consumption_ledger_id,receipt_ledger_id,
          allocation_type,quantity,unit_cost,total_cost
        ) VALUES (
          v_run,e.id,v_lot.receipt_ledger_id,'fifo',v_take,v_lot.unit_cost,v_take*v_lot.unit_cost
        );

        UPDATE rf_lots SET available_qty=available_qty-v_take WHERE id=v_lot.id;
        v_remaining:=v_remaining-v_take;
      END LOOP;

      IF v_remaining>0 THEN
        INSERT INTO rf_debts(
          raw_material_id,branch_id,warehouse_id,consumption_ledger_id,
          oversold_batch_id,debt_quantity,remaining_qty,event_at
        ) VALUES (
          e.raw_material_id,e.branch_id,e.warehouse_id,e.id,
          v_batch_id,
          v_remaining,v_remaining,e.created_at
        );

        UPDATE public.raw_fifo_backfill_plan
        SET debt_quantity=v_remaining,
            unresolved_quantity=v_remaining
        WHERE run_id=v_run AND consumption_ledger_id=e.id;
      END IF;
    END IF;
  END LOOP;

  -- Target residual quantities for positive receipt batches.
  INSERT INTO public.raw_fifo_backfill_batch_plan(
    run_id,batch_id,raw_material_id,branch_id,warehouse_id,current_quantity,target_quantity
  )
  SELECT
    v_run,b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity,
    COALESCE(sum(l.available_qty),0)
  FROM public.raw_material_batches b
  JOIN (
    SELECT DISTINCT batch_id FROM rf_lots
  ) x ON x.batch_id=b.id
  LEFT JOIN rf_lots l ON l.batch_id=b.id
  GROUP BY b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity;

  -- Target residual quantities for historical oversold debt batches.
  INSERT INTO public.raw_fifo_backfill_batch_plan(
    run_id,batch_id,raw_material_id,branch_id,warehouse_id,current_quantity,target_quantity
  )
  SELECT
    v_run,b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity,
    -COALESCE(sum(d.remaining_qty),0)
  FROM public.raw_material_batches b
  JOIN (
    SELECT DISTINCT oversold_batch_id
    FROM rf_debts WHERE oversold_batch_id IS NOT NULL
  ) x ON x.oversold_batch_id=b.id
  LEFT JOIN rf_debts d ON d.oversold_batch_id=b.id
  GROUP BY b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity
  ON CONFLICT(run_id,batch_id) DO UPDATE
  SET target_quantity=EXCLUDED.target_quantity;

  -- Include positive receipt batches fully exhausted during replay.
  INSERT INTO public.raw_fifo_backfill_batch_plan(
    run_id,batch_id,raw_material_id,branch_id,warehouse_id,current_quantity,target_quantity
  )
  SELECT DISTINCT
    v_run,b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity,0
  FROM public.raw_fifo_backfill_allocations a
  JOIN public.inventory_ledger r ON r.id=a.receipt_ledger_id
  JOIN public.raw_material_batches b
    ON b.raw_material_id=r.raw_material_id
   AND b.branch_id=r.branch_id
   AND b.warehouse_id=r.warehouse_id
   AND b.batch_number IS NOT DISTINCT FROM r.batch_number
  WHERE a.run_id=v_run
  ON CONFLICT(run_id,batch_id) DO NOTHING;

  SELECT count(*) INTO v_unknown
  FROM public.raw_fifo_backfill_plan p
  WHERE p.run_id=v_run
    AND abs(p.target_cost-p.current_cost)>0.005
    AND COALESCE(p.reference_type,'') NOT IN (
      'sale','kitchen_send','production','purchase_return','warehouse_transfer'
    );

  IF v_unknown>0 THEN
    RAISE EXCEPTION 'FIFO_BACKFILL_UNSUPPORTED_CHANGED_REFERENCES count=%',v_unknown;
  END IF;

  -- Replay must preserve net stock quantity per raw/branch/warehouse.
  SELECT count(*) INTO v_batch_mismatch
  FROM (
    SELECT
      bp.raw_material_id,bp.branch_id,bp.warehouse_id,
      sum(bp.target_quantity) target_qty,
      (
        SELECT COALESCE(sum(il.quantity),0)
        FROM public.inventory_ledger il
        WHERE il.raw_material_id=bp.raw_material_id
          AND il.branch_id=bp.branch_id
          AND il.warehouse_id=bp.warehouse_id
          AND il.id<=v_cutoff
      ) ledger_qty
    FROM public.raw_fifo_backfill_batch_plan bp
    WHERE bp.run_id=v_run
    GROUP BY bp.raw_material_id,bp.branch_id,bp.warehouse_id
  ) q
  WHERE abs(q.target_qty-q.ledger_qty)>0.0001;

  -- The batch plan only contains batches touched by replay. Add untouched current
  -- batches before validating totals.
  IF v_batch_mismatch>0 THEN
    DELETE FROM public.raw_fifo_backfill_batch_plan WHERE run_id=v_run;

    INSERT INTO public.raw_fifo_backfill_batch_plan(
      run_id,batch_id,raw_material_id,branch_id,warehouse_id,current_quantity,target_quantity
    )
    SELECT
      v_run,b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity,
      COALESCE((
        SELECT sum(l.available_qty)
        FROM rf_lots l WHERE l.batch_id=b.id
      ),0)
      - COALESCE((
        SELECT sum(d.remaining_qty)
        FROM rf_debts d WHERE d.oversold_batch_id=b.id
      ),0)
    FROM public.raw_material_batches b
    WHERE (p_branch_id IS NULL OR b.branch_id=p_branch_id)
      AND EXISTS(
        SELECT 1 FROM public.inventory_ledger il
        WHERE il.raw_material_id=b.raw_material_id
          AND il.branch_id=b.branch_id
          AND il.warehouse_id=b.warehouse_id
          AND il.batch_number IS NOT DISTINCT FROM b.batch_number
          AND il.id<=v_cutoff
      );

    SELECT count(*) INTO v_batch_mismatch
    FROM (
      SELECT
        bp.raw_material_id,bp.branch_id,bp.warehouse_id,
        sum(bp.target_quantity) target_qty,
        (
          SELECT COALESCE(sum(il.quantity),0)
          FROM public.inventory_ledger il
          WHERE il.raw_material_id=bp.raw_material_id
            AND il.branch_id=bp.branch_id
            AND il.warehouse_id=bp.warehouse_id
            AND il.id<=v_cutoff
        ) ledger_qty
      FROM public.raw_fifo_backfill_batch_plan bp
      WHERE bp.run_id=v_run
      GROUP BY bp.raw_material_id,bp.branch_id,bp.warehouse_id
    ) q
    WHERE abs(q.target_qty-q.ledger_qty)>0.0001;
  END IF;

  IF v_batch_mismatch>0 THEN
    RAISE EXCEPTION 'FIFO_BACKFILL_NET_QUANTITY_MISMATCH count=%',v_batch_mismatch;
  END IF;

  SELECT jsonb_build_object(
    'run_id',v_run,
    'branch_id',p_branch_id,
    'cutoff_ledger_id',v_cutoff,
    'consumption_rows',count(*),
    'changed_rows',count(*) FILTER (WHERE abs(target_cost-current_cost)>0.005),
    'positive_delta_rows',count(*) FILTER (WHERE target_cost-current_cost>0.005),
    'negative_delta_rows',count(*) FILTER (WHERE current_cost-target_cost>0.005),
    'net_cost_delta',round(COALESCE(sum(target_cost-current_cost),0),2),
    'debt_quantity',round(COALESCE(sum(debt_quantity),0),4),
    'unresolved_quantity',round(COALESCE(sum(unresolved_quantity),0),4),
    'unresolved_rows',count(*) FILTER (WHERE unresolved_quantity>0)
  )
  INTO v_summary
  FROM public.raw_fifo_backfill_plan
  WHERE run_id=v_run;

  UPDATE public.raw_fifo_backfill_runs
  SET status='prepared',summary=v_summary
  WHERE id=v_run;

  RETURN v_summary;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_backfill_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=v_run;
  RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.raw_fifo_price_fallback_apply(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.raw_fifo_price_fallback_runs%ROWTYPE;
  v_row public.raw_fifo_price_fallback_plan%ROWTYPE;
  v_source public.inventory_ledger%ROWTYPE;
  v_debt public.raw_fifo_debts%ROWTYPE;
  v_res jsonb;
  v_applied integer:=0;
  v_provisional integer:=0;
  v_value numeric(18,6):=0;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_price_fallback_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_RUN_NOT_FOUND');
  END IF;
  IF v_run.status='applied' THEN
    RETURN jsonb_build_object('success',true,'already_applied',true,'run_id',v_run.id,'summary',v_run.summary);
  END IF;
  IF v_run.status<>'prepared' THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_NOT_PREPARED','status',v_run.status);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fifo-price-fallback:'||v_run.branch_id::text,0));

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='applying',error_text=NULL
  WHERE id=v_run.id;

  FOR v_row IN
    SELECT *
    FROM public.raw_fifo_price_fallback_plan
    WHERE run_id=v_run.id AND eligible
    ORDER BY source_created_at,source_ledger_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)
    );

    SELECT * INTO v_source
    FROM public.inventory_ledger
    WHERE id=v_row.source_ledger_id
    FOR UPDATE;

    IF v_source.id IS NULL
       OR v_source.branch_id IS DISTINCT FROM v_row.branch_id
       OR v_source.raw_material_id IS DISTINCT FROM v_row.raw_material_id
       OR v_source.warehouse_id IS DISTINCT FROM v_row.warehouse_id
       OR v_source.reference_type IS DISTINCT FROM v_row.reference_type
       OR v_source.reference_id IS DISTINCT FROM v_row.reference_id
       OR v_source.quantity>=0
       OR abs(abs(v_source.quantity)-v_row.source_quantity)>0.000001
       OR abs(COALESCE(v_source.total_cost,0))>0.005 THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_SOURCE_CHANGED ledger=%',v_row.source_ledger_id;
    END IF;

    IF COALESCE(v_row.candidate_unit_cost,0)<=0
       OR v_row.candidate_at IS NULL
       OR v_row.candidate_at>v_source.created_at
       OR COALESCE(v_row.target_cost,0)<=0 THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_CANDIDATE_INVALID ledger=%',v_row.source_ledger_id;
    END IF;

    IF v_row.open_debt_quantity>0 THEN
      SELECT * INTO v_debt
      FROM public.raw_fifo_debts
      WHERE id=v_row.debt_id
      FOR UPDATE;

      IF v_debt.id IS NULL
         OR v_debt.source_ledger_id<>v_row.source_ledger_id
         OR abs((v_debt.debt_quantity-v_debt.settled_quantity)-v_row.open_debt_quantity)>0.000001 THEN
        RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_DEBT_CHANGED ledger=%',v_row.source_ledger_id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.raw_fifo_debt_price_estimates e
        WHERE e.debt_id=v_debt.id
      ) THEN
        RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_ESTIMATE_EXISTS ledger=%',v_row.source_ledger_id;
      END IF;
    END IF;

    v_res:=public._fifo_adjust_reference_delta(
      v_row.reference_type,
      v_row.reference_id,
      v_row.branch_id,
      v_row.warehouse_id,
      'raw_material',
      v_row.raw_material_id,
      v_row.target_cost,
      0
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REFERENCE_FAILED ledger=% detail=%',
        v_row.source_ledger_id,v_res;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=-v_row.target_cost,
        unit_cost=v_row.target_cost/v_row.source_quantity
    WHERE id=v_row.source_ledger_id;

    IF v_row.open_debt_quantity>0 THEN
      INSERT INTO public.raw_fifo_debt_price_estimates(
        debt_id,source_ledger_id,run_id,branch_id,raw_material_id,
        estimated_unit_cost,original_estimated_quantity,remaining_estimated_quantity,
        candidate_source,candidate_event_id,candidate_at
      ) VALUES (
        v_row.debt_id,v_row.source_ledger_id,v_run.id,v_row.branch_id,v_row.raw_material_id,
        v_row.candidate_unit_cost,v_row.open_debt_quantity,v_row.open_debt_quantity,
        v_row.candidate_source,v_row.candidate_event_id,v_row.candidate_at
      );
      v_provisional:=v_provisional+1;
    END IF;

    v_applied:=v_applied+1;
    v_value:=v_value+v_row.target_cost;
  END LOOP;

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='applied',
      applied_at=now(),
      summary=COALESCE(summary,'{}'::jsonb)||jsonb_build_object(
        'applied_rows',v_applied,
        'provisional_rows',v_provisional,
        'applied_value',round(v_value,2)
      ),
      error_text=NULL
  WHERE id=v_run.id;

  RETURN jsonb_build_object(
    'success',true,'run_id',v_run.id,
    'applied_rows',v_applied,
    'provisional_rows',v_provisional,
    'applied_value',round(v_value,2)
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_price_fallback_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.raw_fifo_price_fallback_prepare(p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run uuid:=gen_random_uuid();
  v_summary jsonb;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id=p_branch_id
  ) THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_BRANCH_NOT_FOUND');
  END IF;

  INSERT INTO public.raw_fifo_price_fallback_runs(id,branch_id,status)
  VALUES(v_run,p_branch_id,'preparing');

  INSERT INTO public.raw_fifo_price_fallback_plan(
    run_id,source_ledger_id,debt_id,raw_material_id,branch_id,warehouse_id,
    reference_type,reference_id,reference_number,source_created_at,
    source_quantity,open_debt_quantity,
    candidate_unit_cost,candidate_source,candidate_event_id,candidate_at,
    target_cost,eligible,unresolved_reason
  )
  SELECT
    v_run,
    il.id,
    d.id,
    il.raw_material_id,
    il.branch_id,
    il.warehouse_id,
    il.reference_type,
    il.reference_id,
    il.reference_number,
    il.created_at,
    abs(il.quantity)::numeric(18,6),
    GREATEST(COALESCE(d.debt_quantity-d.settled_quantity,0),0)::numeric(18,6),
    e.unit_cost,
    e.source,
    e.event_id,
    e.priced_at,
    CASE WHEN e.unit_cost>0 THEN round(abs(il.quantity)*e.unit_cost,6) END,
    COALESCE((
      e.unit_cost>0
      AND e.priced_at<=il.created_at
      AND il.reference_id IS NOT NULL
      AND COALESCE(il.reference_type,'') IN ('sale','kitchen_send','production','purchase_return')
      AND NOT (
        COALESCE(d.debt_quantity-d.settled_quantity,0)>0
        AND EXISTS (
          SELECT 1
          FROM public.raw_fifo_debt_price_estimates x
          WHERE x.debt_id=d.id
            AND x.remaining_estimated_quantity>0
        )
      )
    ),false),
    CASE
      WHEN e.unit_cost IS NULL THEN 'NO_PRIOR_AUTHORITATIVE_PRICE'
      WHEN e.priced_at>il.created_at THEN 'FUTURE_PRICE_REFUSED'
      WHEN il.reference_id IS NULL THEN 'REFERENCE_ID_MISSING'
      WHEN COALESCE(il.reference_type,'') NOT IN ('sale','kitchen_send','production','purchase_return')
        THEN 'REFERENCE_TYPE_UNSUPPORTED'
      WHEN COALESCE(d.debt_quantity-d.settled_quantity,0)>0
       AND EXISTS (
         SELECT 1
         FROM public.raw_fifo_debt_price_estimates x
         WHERE x.debt_id=d.id
           AND x.remaining_estimated_quantity>0
       ) THEN 'ACTIVE_DEBT_ESTIMATE_EXISTS'
      ELSE NULL
    END
  FROM public.inventory_ledger il
  LEFT JOIN public.raw_fifo_debts d
    ON d.source_ledger_id=il.id
  LEFT JOIN LATERAL (
    SELECT ce.event_id,ce.unit_cost,ce.source,ce.priced_at
    FROM public._raw_cost_events_for_costing(il.raw_material_id,il.branch_id) ce
    WHERE ce.unit_cost>0
      AND ce.priced_at<=il.created_at
    ORDER BY ce.priced_at DESC,ce.source_rank,ce.event_id
    LIMIT 1
  ) e ON true
  WHERE il.branch_id=p_branch_id
    AND il.raw_material_id IS NOT NULL
    AND il.warehouse_id IS NOT NULL
    AND il.quantity<0
    AND abs(COALESCE(il.total_cost,0))<=0.005;

  SELECT jsonb_build_object(
    'success',true,
    'run_id',v_run,
    'branch_id',p_branch_id,
    'zero_cost_rows',count(*),
    'eligible_rows',count(*) FILTER (WHERE eligible),
    'unresolved_rows',count(*) FILTER (WHERE NOT eligible),
    'eligible_materials',count(DISTINCT raw_material_id) FILTER (WHERE eligible),
    'provisional_debt_rows',count(*) FILTER (WHERE eligible AND open_debt_quantity>0),
    'provisional_debt_quantity',round(COALESCE(sum(open_debt_quantity) FILTER (WHERE eligible),0),4),
    'target_cost_value',round(COALESCE(sum(target_cost) FILTER (WHERE eligible),0),2)
  )
  INTO v_summary
  FROM public.raw_fifo_price_fallback_plan
  WHERE run_id=v_run;

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='prepared',summary=v_summary,error_text=NULL
  WHERE id=v_run;

  RETURN v_summary;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_price_fallback_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=v_run;
  RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.raw_fifo_price_fallback_reverse(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.raw_fifo_price_fallback_runs%ROWTYPE;
  v_row public.raw_fifo_price_fallback_plan%ROWTYPE;
  v_source public.inventory_ledger%ROWTYPE;
  v_res jsonb;
  v_reversed integer:=0;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_price_fallback_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_RUN_NOT_FOUND');
  END IF;
  IF v_run.status='reversed' THEN
    RETURN jsonb_build_object('success',true,'already_reversed',true,'run_id',v_run.id);
  END IF;
  IF v_run.status<>'applied' THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_NOT_APPLIED','status',v_run.status);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.raw_fifo_debt_price_estimates e
    WHERE e.run_id=v_run.id
      AND (
        abs(e.remaining_estimated_quantity-e.original_estimated_quantity)>0.000001
        OR e.replaced_quantity>0.000001
        OR e.zero_cost_finalized_quantity>0.000001
      )
  ) THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_PRICE_FALLBACK_ESTIMATE_CONSUMED','run_id',v_run.id
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fifo-price-fallback:'||v_run.branch_id::text,0));

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='reversing',error_text=NULL
  WHERE id=v_run.id;

  FOR v_row IN
    SELECT *
    FROM public.raw_fifo_price_fallback_plan
    WHERE run_id=v_run.id AND eligible
    ORDER BY source_created_at DESC,source_ledger_id DESC
  LOOP
    SELECT * INTO v_source
    FROM public.inventory_ledger
    WHERE id=v_row.source_ledger_id
    FOR UPDATE;

    IF v_source.id IS NULL
       OR v_source.quantity>=0
       OR abs(COALESCE(v_source.total_cost,0)+v_row.target_cost)>0.005 THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REVERSE_SOURCE_CHANGED ledger=%',v_row.source_ledger_id;
    END IF;

    v_res:=public._fifo_adjust_reference_delta(
      v_row.reference_type,
      v_row.reference_id,
      v_row.branch_id,
      v_row.warehouse_id,
      'raw_material',
      v_row.raw_material_id,
      -v_row.target_cost,
      0
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REVERSE_REFERENCE_FAILED ledger=% detail=%',
        v_row.source_ledger_id,v_res;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=0,unit_cost=0
    WHERE id=v_row.source_ledger_id;

    v_reversed:=v_reversed+1;
  END LOOP;

  DELETE FROM public.raw_fifo_debt_price_estimates
  WHERE run_id=v_run.id;

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='reversed',reversed_at=now(),error_text=NULL
  WHERE id=v_run.id;

  RETURN jsonb_build_object('success',true,'run_id',v_run.id,'reversed_rows',v_reversed);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_price_fallback_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.raw_fifo_reverse_backfill(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.raw_fifo_backfill_runs%ROWTYPE;
  v_latest bigint;
  v_row record;
  v_res jsonb;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_backfill_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_RUN_NOT_FOUND'
    );
  END IF;

  IF v_run.status='reversed' THEN
    RETURN jsonb_build_object(
      'success',true,
      'already_reversed',true,
      'run_id',v_run.id
    );
  END IF;

  IF v_run.status<>'applied' THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_NOT_APPLIED',
      'status',v_run.status
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'raw-fifo-backfill:'||COALESCE(v_run.branch_id::text,'all'),
      0
    )
  );

  FOR v_row IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_fifo_backfill_plan
    WHERE run_id=p_run_id
    ORDER BY branch_id,raw_material_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        v_row.raw_material_id::text||':'||v_row.branch_id::text,
        0
      )
    );
  END LOOP;

  SELECT COALESCE(max(id),0)
  INTO v_latest
  FROM public.inventory_ledger
  WHERE raw_material_id IS NOT NULL
    AND warehouse_id IS NOT NULL
    AND (v_run.branch_id IS NULL OR branch_id=v_run.branch_id);

  IF v_latest<>v_run.cutoff_ledger_id THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_REVERSE_STALE',
      'backfill_cutoff',v_run.cutoff_ledger_id,
      'current_cutoff',v_latest
    );
  END IF;

  UPDATE public.raw_fifo_backfill_runs
  SET status='reversing',
      reverse_error_text=NULL
  WHERE id=p_run_id;

  -- Undo valuation propagation in reverse source order.
  FOR v_row IN
    SELECT p.*
    FROM public.raw_fifo_backfill_plan p
    WHERE p.run_id=p_run_id
      AND abs(p.target_cost-p.current_cost)>0.005
    ORDER BY p.source_created_at DESC,p.consumption_ledger_id DESC
  LOOP
    v_res:=public._fifo_adjust_reference_delta(
      v_row.reference_type,
      v_row.reference_id,
      v_row.branch_id,
      v_row.warehouse_id,
      'raw_material',
      v_row.raw_material_id,
      -(v_row.target_cost-v_row.current_cost),
      0
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION
        'FIFO_BACKFILL_REVERSE_REFERENCE_FAILED ledger=% detail=%',
        v_row.consumption_ledger_id,
        v_res;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=-v_row.current_cost,
        unit_cost=CASE
          WHEN v_row.quantity>0
            THEN v_row.current_cost/v_row.quantity
          ELSE 0
        END
    WHERE id=v_row.consumption_ledger_id;
  END LOOP;

  -- Restore exact pre-backfill batch residual quantities.
  UPDATE public.raw_material_batches b
  SET quantity=bp.current_quantity
  FROM public.raw_fifo_backfill_batch_plan bp
  WHERE bp.run_id=p_run_id
    AND bp.batch_id=b.id;

  -- Remove only historical settlement/debt rows materialized by this run.
  DELETE FROM public.raw_fifo_settlements s
  WHERE s.run_id=p_run_id;

  DELETE FROM public.raw_fifo_debts d
  WHERE d.backfill_run_id=p_run_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.raw_fifo_settlements s
      WHERE s.debt_id=d.id
    );

  -- Restore any older historical debt/settlement state that this run
  -- temporarily rebased before rebuilding the current replay allocation map.
  v_res:=public._raw_fifo_restore_rebased_debt_state(p_run_id);
  IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FIFO_BACKFILL_DEBT_REBASE_RESTORE_FAILED detail=%',v_res;
  END IF;

  -- Remove zeroed reconciliation journal shells produced solely by this run.
  DELETE FROM public.journal_entries je
  USING public.raw_fifo_sale_cogs_adjustments a
  WHERE a.journal_entry_id=je.id
    AND abs(a.exact_delta)<=0.005
    AND abs(a.posted_delta)<=0.005
    AND je.reference_type='fifo_cogs_reconcile';

  UPDATE public.raw_fifo_sale_cogs_adjustments
  SET journal_entry_id=NULL
  WHERE abs(exact_delta)<=0.005
    AND abs(posted_delta)<=0.005
    AND journal_entry_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id=raw_fifo_sale_cogs_adjustments.journal_entry_id
    );

  DELETE FROM public.raw_fifo_sale_cogs_adjustments
  WHERE abs(exact_delta)<=0.005
    AND abs(posted_delta)<=0.005
    AND journal_entry_id IS NULL;

  DELETE FROM public.journal_entries je
  USING public.raw_fifo_stock_adjustments a
  WHERE a.journal_entry_id=je.id
    AND abs(a.exact_delta)<=0.005
    AND abs(a.posted_delta)<=0.005
    AND je.reference_type='fifo_stock_reconcile';

  UPDATE public.raw_fifo_stock_adjustments
  SET journal_entry_id=NULL
  WHERE abs(exact_delta)<=0.005
    AND abs(posted_delta)<=0.005
    AND journal_entry_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id=raw_fifo_stock_adjustments.journal_entry_id
    );

  DELETE FROM public.raw_fifo_stock_adjustments
  WHERE abs(exact_delta)<=0.005
    AND abs(posted_delta)<=0.005
    AND journal_entry_id IS NULL;

  -- Refresh branch aggregate cache from restored canonical batches.
  FOR v_row IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_fifo_backfill_batch_plan
    WHERE run_id=p_run_id
  LOOP
    INSERT INTO public.raw_material_inventory(
      raw_material_id,branch_id,quantity,avg_cost
    )
    SELECT
      v_row.raw_material_id,
      v_row.branch_id,
      COALESCE(sum(b.quantity),0),
      CASE
        WHEN COALESCE(sum(b.quantity),0)>0 THEN
          round(
            COALESCE(sum(b.quantity*COALESCE(b.unit_cost,0)),0)
            / sum(b.quantity),
            2
          )
        ELSE 0
      END
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=v_row.raw_material_id
      AND b.branch_id=v_row.branch_id
    ON CONFLICT(raw_material_id,branch_id) DO UPDATE
    SET quantity=EXCLUDED.quantity,
        avg_cost=EXCLUDED.avg_cost,
        updated_at=now();
  END LOOP;

  UPDATE public.raw_fifo_backfill_runs
  SET status='reversed',
      reversed_at=now(),
      reverse_error_text=NULL
  WHERE id=p_run_id;

  RETURN jsonb_build_object(
    'success',true,
    'run_id',p_run_id,
    'reversed',true
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_backfill_runs
  SET status='failed',
      reverse_error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.raw_opening_cost_apply_repair(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.raw_opening_cost_repair_runs%ROWTYPE;
  v_row public.raw_opening_cost_repair_plan%ROWTYPE;
  v_backfill jsonb;
  v_backfill_apply jsonb;
  v_backfill_run uuid;
  v_summary jsonb;
  v_applied integer:=0;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_opening_cost_repair_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','OPENING_COST_REPAIR_RUN_NOT_FOUND');
  END IF;

  IF v_run.status='applied' THEN
    RETURN jsonb_build_object(
      'success',true,'already_applied',true,'run_id',v_run.id,
      'fifo_backfill_run_id',v_run.fifo_backfill_run_id,'summary',v_run.summary
    );
  END IF;

  IF v_run.status<>'prepared' THEN
    RETURN jsonb_build_object(
      'success',false,'error','OPENING_COST_REPAIR_NOT_PREPARED','status',v_run.status
    );
  END IF;

  UPDATE public.raw_opening_cost_repair_runs
  SET status='applying',error_text=NULL
  WHERE id=v_run.id;

  FOR v_row IN
    SELECT *
    FROM public.raw_opening_cost_repair_plan
    WHERE run_id=v_run.id AND eligible
    ORDER BY branch_id,raw_material_id,warehouse_id,batch_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)
    );

    IF NOT EXISTS(
      SELECT 1
      FROM public.raw_material_batches b
      WHERE b.id=v_row.batch_id
        AND b.raw_material_id=v_row.raw_material_id
        AND b.branch_id=v_row.branch_id
        AND b.warehouse_id=v_row.warehouse_id
        AND b.batch_number IS NOT DISTINCT FROM v_row.batch_number
        AND b.source_type='opening_inventory'
        AND COALESCE(b.unit_cost,0)=0
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_BATCH_CHANGED batch=%',v_row.batch_id;
    END IF;

    IF NOT EXISTS(
      SELECT 1
      FROM public.inventory_ledger il
      WHERE il.id=v_row.opening_ledger_id
        AND il.raw_material_id=v_row.raw_material_id
        AND il.branch_id=v_row.branch_id
        AND il.warehouse_id=v_row.warehouse_id
        AND il.batch_number IS NOT DISTINCT FROM v_row.batch_number
        AND il.reference_type='opening_inventory'
        AND il.quantity=v_row.opening_quantity
        AND COALESCE(il.unit_cost,0)=0
        AND COALESCE(il.total_cost,0)=0
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_LEDGER_CHANGED ledger=%',v_row.opening_ledger_id;
    END IF;

    IF COALESCE(v_row.candidate_cost,0)<=0 OR v_row.candidate_at IS NULL THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_INVALID_CANDIDATE batch=%',v_row.batch_id;
    END IF;

    IF v_row.candidate_at > (
      SELECT b.created_at FROM public.raw_material_batches b WHERE b.id=v_row.batch_id
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_FUTURE_CANDIDATE batch=%',v_row.batch_id;
    END IF;

    UPDATE public.raw_material_batches
    SET unit_cost=v_row.candidate_cost
    WHERE id=v_row.batch_id;

    UPDATE public.inventory_ledger
    SET unit_cost=v_row.candidate_cost,
        total_cost=round(quantity*v_row.candidate_cost,2)
    WHERE id=v_row.opening_ledger_id;

    v_applied:=v_applied+1;
  END LOOP;

  -- Re-run the already-tested historical FIFO engine against the corrected
  -- opening receipt valuation. This changes valuation only; its own guards
  -- enforce stock-quantity invariants and supported reference types.
  v_backfill:=public.raw_fifo_prepare_backfill(v_run.branch_id);
  v_backfill_run:=NULLIF(v_backfill->>'run_id','')::uuid;

  IF v_backfill_run IS NULL THEN
    RAISE EXCEPTION 'OPENING_COST_REPAIR_FIFO_PREPARE_FAILED detail=%',v_backfill;
  END IF;

  v_backfill_apply:=public.raw_fifo_apply_backfill(v_backfill_run);
  IF COALESCE((v_backfill_apply->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OPENING_COST_REPAIR_FIFO_APPLY_FAILED detail=%',v_backfill_apply;
  END IF;

  v_summary:=COALESCE(v_run.summary,'{}'::jsonb)
    || jsonb_build_object(
      'success',true,
      'applied_batches',v_applied,
      'fifo_backfill_run_id',v_backfill_run,
      'fifo_backfill_summary',v_backfill
    );

  UPDATE public.raw_opening_cost_repair_runs
  SET status='applied',
      fifo_backfill_run_id=v_backfill_run,
      summary=v_summary,
      applied_at=now(),
      error_text=NULL
  WHERE id=v_run.id;

  RETURN jsonb_build_object(
    'success',true,
    'run_id',v_run.id,
    'applied_batches',v_applied,
    'fifo_backfill_run_id',v_backfill_run,
    'unresolved_batches',COALESCE((v_run.summary->>'unresolved_batches')::integer,0),
    'fifo_backfill_summary',v_backfill
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_opening_cost_repair_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.raw_opening_cost_reverse_repair(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.raw_opening_cost_repair_runs%ROWTYPE;
  v_row public.raw_opening_cost_repair_plan%ROWTYPE;
  v_reverse jsonb;
  v_scope record;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_opening_cost_repair_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','OPENING_COST_REPAIR_RUN_NOT_FOUND');
  END IF;

  IF v_run.status='reversed' THEN
    RETURN jsonb_build_object('success',true,'already_reversed',true,'run_id',v_run.id);
  END IF;

  IF v_run.status<>'applied' OR v_run.fifo_backfill_run_id IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,'error','OPENING_COST_REPAIR_NOT_APPLIED','status',v_run.status
    );
  END IF;

  UPDATE public.raw_opening_cost_repair_runs
  SET status='reversing',error_text=NULL
  WHERE id=v_run.id;

  v_reverse:=public.raw_fifo_reverse_backfill(v_run.fifo_backfill_run_id);
  IF COALESCE((v_reverse->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OPENING_COST_REPAIR_FIFO_REVERSE_FAILED detail=%',v_reverse;
  END IF;

  FOR v_row IN
    SELECT *
    FROM public.raw_opening_cost_repair_plan
    WHERE run_id=v_run.id AND eligible
    ORDER BY branch_id,raw_material_id,warehouse_id,batch_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)
    );

    IF NOT EXISTS(
      SELECT 1 FROM public.raw_material_batches b
      WHERE b.id=v_row.batch_id
        AND abs(COALESCE(b.unit_cost,0)-v_row.candidate_cost)<=0.000001
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_REVERSE_BATCH_CHANGED batch=%',v_row.batch_id;
    END IF;

    IF NOT EXISTS(
      SELECT 1 FROM public.inventory_ledger il
      WHERE il.id=v_row.opening_ledger_id
        AND abs(COALESCE(il.unit_cost,0)-v_row.candidate_cost)<=0.000001
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_REVERSE_LEDGER_CHANGED ledger=%',v_row.opening_ledger_id;
    END IF;

    UPDATE public.raw_material_batches
    SET unit_cost=0
    WHERE id=v_row.batch_id;

    UPDATE public.inventory_ledger
    SET unit_cost=0,total_cost=0
    WHERE id=v_row.opening_ledger_id;
  END LOOP;

  FOR v_scope IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_opening_cost_repair_plan
    WHERE run_id=v_run.id AND eligible
  LOOP
    INSERT INTO public.raw_material_inventory(
      raw_material_id,branch_id,quantity,avg_cost
    )
    SELECT
      v_scope.raw_material_id,
      v_scope.branch_id,
      COALESCE(sum(b.quantity),0),
      CASE
        WHEN COALESCE(sum(b.quantity),0)>0 THEN
          round(
            COALESCE(sum(b.quantity*COALESCE(b.unit_cost,0)),0)
            / sum(b.quantity),
            2
          )
        ELSE 0
      END
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=v_scope.raw_material_id
      AND b.branch_id=v_scope.branch_id
    ON CONFLICT(raw_material_id,branch_id) DO UPDATE
    SET quantity=EXCLUDED.quantity,
        avg_cost=EXCLUDED.avg_cost,
        updated_at=now();
  END LOOP;

  UPDATE public.raw_opening_cost_repair_runs
  SET status='reversed',reversed_at=now(),error_text=NULL
  WHERE id=v_run.id;

  RETURN jsonb_build_object(
    'success',true,'run_id',v_run.id,
    'fifo_backfill_run_id',v_run.fifo_backfill_run_id,
    'fifo_reverse',v_reverse
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_opening_cost_repair_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$
;
ALTER TABLE public.branches DISABLE TRIGGER raw_last_price_new_branch_default;
REVOKE ALL ON FUNCTION private.apply_raw_stock_count_last_price(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.latest_approved_raw_prices(uuid,uuid[],timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.latest_approved_raw_prices(uuid,uuid[],timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION private.latest_approved_raw_prices(uuid,uuid[],timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION private.offset_stock_count_legacy_quantity(bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.raw_approved_price_visible(text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.raw_approved_price_visible(text,text,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.raw_approved_price_visible(text,text,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamp with time zone,timestamp with time zone,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.raw_receive_approved_v2(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamp with time zone,timestamp with time zone,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.stock_count_raw_price(uuid,uuid[],timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.validate_count_legacy_quantity(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION _capture_kitchen_ingredient_prices() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION _capture_kitchen_ingredient_prices() TO service_role;
REVOKE ALL ON FUNCTION _deduct_kitchen_raw_components(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION _deduct_kitchen_raw_components(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION _raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION _raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION _raw_fifo_settle_receipt(bigint,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION _raw_fifo_settle_receipt(bigint,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION _raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION _raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION get_current_raw_material_valuation(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION get_current_raw_material_valuation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_raw_material_valuation(uuid) TO service_role;
REVOKE ALL ON FUNCTION raw_fifo_apply_backfill(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION raw_fifo_apply_backfill(uuid) TO service_role;
REVOKE ALL ON FUNCTION raw_fifo_prepare_backfill(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION raw_fifo_prepare_backfill(uuid) TO service_role;
REVOKE ALL ON FUNCTION raw_fifo_price_fallback_apply(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION raw_fifo_price_fallback_apply(uuid) TO service_role;
REVOKE ALL ON FUNCTION raw_fifo_price_fallback_prepare(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION raw_fifo_price_fallback_prepare(uuid) TO service_role;
REVOKE ALL ON FUNCTION raw_fifo_price_fallback_reverse(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION raw_fifo_price_fallback_reverse(uuid) TO service_role;
REVOKE ALL ON FUNCTION raw_fifo_reverse_backfill(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION raw_fifo_reverse_backfill(uuid) TO service_role;
REVOKE ALL ON FUNCTION raw_opening_cost_apply_repair(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION raw_opening_cost_apply_repair(uuid) TO service_role;
REVOKE ALL ON FUNCTION raw_opening_cost_reverse_repair(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION raw_opening_cost_reverse_repair(uuid) TO service_role;
REVOKE SELECT ON private.raw_cost_v2_activated_coordinates FROM service_role;
COMMIT;
