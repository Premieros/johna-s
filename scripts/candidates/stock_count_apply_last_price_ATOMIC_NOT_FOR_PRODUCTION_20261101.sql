-- DO NOT DEPLOY: depends on UNINSTALLED private approved-v2 physical helpers.
-- Uses the existing central approved-price source, never FIFO for raw counts.
-- Missing price and legacy debt coordinates fail closed; no rollout is authorized.
-- Requires independent disposable-DB and accounting reconciliation tests.
CREATE OR REPLACE FUNCTION public.apply_stock_count(p_stock_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count public.stock_counts%ROWTYPE;
  v_item public.stock_count_items%ROWTYPE;
  v_current numeric(14,4);
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

    FOR v_item IN
      SELECT *
      FROM public.stock_count_items
      WHERE stock_count_id = p_stock_count_id
      ORDER BY id
      FOR UPDATE
    LOOP
      v_value := 0;

      IF v_item.raw_material_id IS NOT NULL THEN
        -- Resolve as of the physical count document creation time (pending explicit
        -- physical counted_at support). Never invent a price from count snapshots.
        SELECT p.unit_cost,p.price_source
          INTO v_final_price,v_price_source
          FROM private.latest_approved_raw_prices(
            v_count.branch_id,ARRAY[v_item.raw_material_id],v_count.created_at
          ) p WHERE p.raw_material_id=v_item.raw_material_id;
        -- Explicitly recorded zero is a valid cost. Missing (NULL / unpriced)
        -- and negative prices are invalid. The source projection must be updated
        -- separately to preserve legitimate zero-priced source events.
        -- Applied historical stock counts are filtered by its visibility predicate.
        IF v_final_price IS NULL OR v_final_price < 0 THEN
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
        SELECT COALESCE(quantity, 0)
          INTO v_current
          FROM public.raw_material_warehouse_inventory
          WHERE raw_material_id = v_item.raw_material_id
            AND branch_id = v_count.branch_id
            AND warehouse_id = v_count.warehouse_id;

        v_current := COALESCE(v_current, 0);
        v_variance := v_item.counted_quantity - v_current;

        IF v_variance > 0 THEN
          -- Candidate-only approved-price physical receipt; no legacy FIFO writer.
          v_res := private.raw_receive_approved_v2(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            v_variance, v_final_price,
            'adjustment', 'stock_count', v_count.id, v_count.count_number, auth.uid()
          );
          IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED: %', 'RAW_ADJUST_FAILED';
          END IF;
          v_value := round(v_variance * COALESCE(v_final_price, 0), 2);
          v_rm_delta := v_rm_delta + v_value;
        ELSIF v_variance < 0 THEN
          v_res := private.raw_issue_approved_v2(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            -v_variance, 'adjustment', 'stock_count', v_count.id,
            v_count.count_number, auth.uid(), v_count.created_at
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
      ELSE
        SELECT COALESCE(quantity, 0)
          INTO v_current
          FROM public.inventory
          WHERE product_id = v_item.product_id
            AND warehouse_id = v_count.warehouse_id;

        v_current := COALESCE(v_current, 0);
        v_variance := v_item.counted_quantity - v_current;

        IF v_variance > 0 THEN
          v_res := public._product_inv_add(
            v_item.product_id, v_count.warehouse_id, v_count.branch_id,
            v_variance, v_item.unit_cost, NULL, NULL, NULL,
            'adjustment', 'stock_count', v_count.id, v_count.count_number, auth.uid()
          );
          IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED: %', 'ADJUST_FAILED';
          END IF;
          v_value := round(v_variance * COALESCE(v_item.unit_cost, 0), 2);
          v_fg_delta := v_fg_delta + v_value;
        ELSIF v_variance < 0 THEN
          v_res := public._product_inv_remove_fifo(
            v_item.product_id, v_count.warehouse_id, v_count.branch_id,
            -v_variance, 'adjustment', 'stock_count', v_count.id,
            v_count.count_number, auth.uid()
          );
          IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
            RAISE EXCEPTION 'PRODUCT_STOCK_COUNT_REMOVE_FAILED: %',COALESCE(v_res->>'error','unknown');
          END IF;
          v_shortage := COALESCE((v_res->>'shortage')::numeric, 0);
          IF v_shortage > 0 THEN
            RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED: %', 'STOCK_COUNT_SHORTAGE';
          END IF;
          v_value := round(COALESCE((v_res->>'total_cost')::numeric, 0), 2);
          v_fg_delta := v_fg_delta - v_value;
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
