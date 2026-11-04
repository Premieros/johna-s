-- DO NOT DEPLOY: depends on UNINSTALLED private approved-v2 physical helpers.
-- Uses the existing central approved-price source, never FIFO for raw counts.
-- Missing price and legacy debt coordinates fail closed; no rollout is authorized.
-- Requires independent disposable-DB and accounting reconciliation tests.
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
    SELECT jsonb_object_agg(p.raw_material_id::text,to_jsonb(p)) INTO v_prices
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
$function$;
REVOKE ALL ON FUNCTION private.apply_raw_stock_count_last_price(uuid) FROM PUBLIC,anon,authenticated,service_role;
