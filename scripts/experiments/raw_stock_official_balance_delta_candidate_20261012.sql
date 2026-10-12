-- #489 isolated stage B. Not a migration; NEVER run on production.
-- Reuses public.raw_material_inventory. Does not create shadow tables or triggers.
-- Per-warehouse SUM before_qty remains required for future multi-warehouse support.
-- Existing positive-only avg_cost guard and permission boundary remain untouched.
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

  -- One official branch-row update per logical receipt under the existing
  -- material/branch advisory transaction lock. The unchanged avg_cost BEFORE
  -- trigger derives its value from positive FIFO batches.
  UPDATE public.raw_material_inventory
  SET quantity=quantity+p_qty,updated_at=now()
  WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
  RETURNING quantity,avg_cost INTO v_branch_qty,v_branch_avg;
  IF NOT FOUND THEN
    -- Exceptional recovery only: reconcile a group without a saved row.
    SELECT COALESCE(SUM(quantity),0) INTO v_branch_qty
    FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
    INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
    VALUES(p_raw_material_id,p_branch_id,v_branch_qty,0)
    ON CONFLICT(raw_material_id,branch_id) DO UPDATE
    SET quantity=EXCLUDED.quantity,updated_at=now()
    RETURNING quantity,avg_cost INTO v_branch_qty,v_branch_avg;
  END IF;
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

  -- Strict no-stock removals must not deduct the unconsumed shortage.
  IF v_total_removed+v_oversold>0 THEN
    UPDATE public.raw_material_inventory
    SET quantity=quantity-(v_total_removed+v_oversold),updated_at=now()
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
    RETURNING quantity INTO v_branch_qty;
    IF NOT FOUND THEN
      -- Exceptional recovery only, protected by the advisory lock.
      SELECT COALESCE(SUM(quantity),0) INTO v_branch_qty
      FROM public.raw_material_batches
      WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
      INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
      VALUES(p_raw_material_id,p_branch_id,v_branch_qty,0)
      ON CONFLICT(raw_material_id,branch_id) DO UPDATE
      SET quantity=EXCLUDED.quantity,updated_at=now();
    END IF;
  END IF;
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
        -- Lock before reading the warehouse snapshot to prevent stale variance.
        PERFORM pg_advisory_xact_lock(hashtextextended(
          v_item.raw_material_id::text||':'||v_count.branch_id::text,0));
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
            RETURN jsonb_build_object(
              'success', false, 'error', 'RAW_ADJUST_FAILED',
              'raw_material_id', v_item.raw_material_id, 'detail', v_res->>'error'
            );
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
            RETURN jsonb_build_object(
              'success', false, 'error', 'STOCK_COUNT_SHORTAGE',
              'raw_material_id', v_item.raw_material_id, 'shortage', v_shortage
            );
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
            RETURN jsonb_build_object(
              'success', false, 'error', 'ADJUST_FAILED',
              'product_id', v_item.product_id, 'detail', v_res->>'error'
            );
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
            RETURN jsonb_build_object(
              'success', false, 'error', 'STOCK_COUNT_SHORTAGE',
              'product_id', v_item.product_id, 'shortage', v_shortage
            );
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
