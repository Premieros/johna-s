-- Restore bindings without deleting posted stock/journals or audit columns.
BEGIN;
SET LOCAL lock_timeout='2s';
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
  v_variance numeric(14,4);
  v_applied integer := 0;
  v_res jsonb;
  -- Keep the original error payload while forcing a subtransaction rollback.
  v_failure jsonb := NULL;
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
        SELECT COALESCE(quantity, 0)
          INTO v_current
          FROM public.raw_material_warehouse_inventory
          WHERE raw_material_id = v_item.raw_material_id
            AND branch_id = v_count.branch_id
            AND warehouse_id = v_count.warehouse_id;

        v_current := COALESCE(v_current, 0);
        v_variance := v_item.counted_quantity - v_current;

        IF v_variance > 0 THEN
          v_res := public._raw_add(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            v_variance, v_item.unit_cost, NULL, NULL, NULL,
            'adjustment', 'stock_count', v_count.id, v_count.count_number, auth.uid()
          );
          IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            v_failure := jsonb_build_object(
              'success', false, 'error', 'RAW_ADJUST_FAILED',
              'raw_material_id', v_item.raw_material_id, 'detail', v_res->>'error'
            );
            RAISE EXCEPTION 'STOCK_COUNT_POSTING_ABORTED' USING ERRCODE = 'P0001';
          END IF;
          v_value := round(v_variance * COALESCE(v_item.unit_cost, 0), 2);
          v_rm_delta := v_rm_delta + v_value;
        ELSIF v_variance < 0 THEN
          v_res := public._raw_remove_fifo(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            -v_variance, 'adjustment', 'stock_count', v_count.id,
            v_count.count_number, auth.uid()
          );
          v_shortage := COALESCE((v_res->>'shortage')::numeric, 0);
          IF v_shortage > 0 THEN
            v_failure := jsonb_build_object(
              'success', false, 'error', 'STOCK_COUNT_SHORTAGE',
              'raw_material_id', v_item.raw_material_id, 'shortage', v_shortage
            );
            RAISE EXCEPTION 'STOCK_COUNT_POSTING_ABORTED' USING ERRCODE = 'P0001';
          END IF;
          v_value := round(COALESCE((v_res->>'total_cost')::numeric, 0), 2);
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
            v_failure := jsonb_build_object(
              'success', false, 'error', 'ADJUST_FAILED',
              'product_id', v_item.product_id, 'detail', v_res->>'error'
            );
            RAISE EXCEPTION 'STOCK_COUNT_POSTING_ABORTED' USING ERRCODE = 'P0001';
          END IF;
          v_value := round(v_variance * COALESCE(v_item.unit_cost, 0), 2);
          v_fg_delta := v_fg_delta + v_value;
        ELSIF v_variance < 0 THEN
          v_res := public._product_inv_remove_fifo(
            v_item.product_id, v_count.warehouse_id, v_count.branch_id,
            -v_variance, 'adjustment', 'stock_count', v_count.id,
            v_count.count_number, auth.uid()
          );
          v_shortage := COALESCE((v_res->>'shortage')::numeric, 0);
          IF v_shortage > 0 THEN
            v_failure := jsonb_build_object(
              'success', false, 'error', 'STOCK_COUNT_SHORTAGE',
              'product_id', v_item.product_id, 'shortage', v_shortage
            );
            RAISE EXCEPTION 'STOCK_COUNT_POSTING_ABORTED' USING ERRCODE = 'P0001';
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
      -- PL/pgSQL rolls back all changes made inside the nested BEGIN block
      -- before entering this handler; local v_failure retains the error.
      IF v_failure IS NOT NULL THEN
        RETURN v_failure;
      END IF;
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TRANSACTION_FAILED',
        'detail', SQLERRM
      );
  END;
END;
$function$;
-- Approved values already posted must stay frozen after a binding rollback.
DO $rollback$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.inventory_ledger WHERE approved_cost_basis='approved_last_known') THEN
  EXECUTE $restore$CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt(p_receipt_ledger_id bigint, p_receipt_batch_id uuid, p_run_id uuid DEFAULT NULL::uuid)
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

    UPDATE public.inventory_ledger
    SET total_cost=v_new_total,
        unit_cost=CASE
          WHEN quantity<0 THEN abs(v_new_total/quantity)
          ELSE unit_cost
        END
    WHERE id=v_source.id;

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
$function$;$restore$;
 END IF;
END $rollback$;
COMMIT;
