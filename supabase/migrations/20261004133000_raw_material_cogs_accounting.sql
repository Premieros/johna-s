-- Correct future restaurant COGS inventory-account routing.
--
-- Active-model behavior:
--   * sales without an explicit ready-product inventory effect route the COGS
--     inventory leg from finished goods (1200) to raw materials (1210);
--   * sales that truly consume ready-product inventory keep finished goods;
--   * refunds reverse the exact 1200/1210 account used by the original sale;
--   * FIFO COGS reconciliation follows the base sale journal and never changes
--     the inventory account of an already-existing reconciliation journal.
--
-- Historical journal rows are intentionally untouched.
-- Purchase, stock-count, physical inventory quantities, POS settlement,
-- Printing / Print Agent, KDS / Send to Kitchen, and shifts are unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public._post_journal_entry(p_branch_id uuid, p_reference_type text, p_reference_id uuid, p_reference_number text, p_description text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account uuid;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_account_key text;
  v_account_code text;
  v_original_inventory_code text;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'JOURNAL_EMPTY_LINES';
  END IF;

  -- Idempotency: never post a second entry for the same reference.
  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM public.journal_entries
    WHERE reference_type = p_reference_type AND reference_id = p_reference_id;
    IF v_entry_id IS NOT NULL THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: debit % <> credit %',
      round(v_total_debit, 2), round(v_total_credit, 2);
  END IF;

  v_entry_no := (public.next_document_number('journal')->>'number')::text;

  INSERT INTO public.journal_entries
    (entry_number, branch_id, entry_date, reference_type, reference_id, reference_number, description, created_by)
  VALUES (v_entry_no, p_branch_id, CURRENT_DATE, p_reference_type, p_reference_id,
          p_reference_number, p_description, auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    IF v_debit <= 0 AND v_credit <= 0 THEN CONTINUE; END IF;

    v_account_key := NULLIF(v_line->>'account_key','');
    v_account_code := NULLIF(v_line->>'account_code','');
    v_original_inventory_code := NULL;

    -- Active restaurant sales normally consume raw materials and operational
    -- inventory units. If the sale has no explicit ready-product inventory
    -- effect, route the COGS inventory leg to raw-material inventory (1210).
    -- A sale that actually consumed product inventory keeps finished goods.
    IF p_reference_type = 'sale'
       AND (
         v_account_key = 'inventory_fg'
         OR upper(btrim(COALESCE(v_account_code,''))) = '1200'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.sale_item_inventory_effects e
         WHERE e.sale_id = p_reference_id
           AND e.target_type = 'product'
       )
    THEN
      IF v_account_key = 'inventory_fg' THEN
        v_account_key := 'inventory_rm';
      END IF;
      IF upper(btrim(COALESCE(v_account_code,''))) = '1200' THEN
        v_account_code := '1210';
      END IF;
    END IF;

    -- Refunds must reverse the exact inventory account used by the original
    -- sale. Historical sales therefore continue to reverse 1200, while sales
    -- created after this repair reverse 1210.
    IF p_reference_type = 'refund'
       AND (
         v_account_key = 'inventory_fg'
         OR upper(btrim(COALESCE(v_account_code,''))) = '1200'
       )
    THEN
      SELECT a.code
      INTO v_original_inventory_code
      FROM public.journal_entries je
      JOIN public.journal_entry_lines jl
        ON jl.journal_entry_id = je.id
      JOIN public.chart_of_accounts a
        ON a.id = jl.account_id
      WHERE je.branch_id = p_branch_id
        AND je.reference_type = 'sale'
        AND je.reference_number = p_reference_number
        AND a.code IN ('1200','1210')
        AND jl.credit > jl.debit
      ORDER BY je.created_at DESC,
               CASE a.code WHEN '1210' THEN 0 ELSE 1 END
      LIMIT 1;

      IF v_original_inventory_code IS NOT NULL THEN
        v_account_key := NULL;
        v_account_code := v_original_inventory_code;
      END IF;
    END IF;

    IF v_account_key IS NOT NULL THEN
      v_account := public.resolve_account_key(p_branch_id, v_account_key, v_account_code);
    ELSE
      SELECT id INTO v_account
      FROM public.chart_of_accounts
      WHERE branch_id = p_branch_id AND code = upper(btrim(v_account_code));
    END IF;
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: %', COALESCE(v_line->>'account_key', v_line->>'account_code');
    END IF;

    INSERT INTO public.journal_entry_lines
      (journal_entry_id, account_id, debit, credit, customer_id, supplier_id, note)
    VALUES (v_entry_id, v_account, v_debit, v_credit,
            (v_line->>'customer_id')::uuid, (v_line->>'supplier_id')::uuid, v_line->>'note');
  END LOOP;

  PERFORM public.log_audit_action(p_branch_id, 'journal_post', 'journal_entry', v_entry_id,
    jsonb_build_object('entry_number', v_entry_no, 'reference_type', p_reference_type,
                       'reference_number', p_reference_number,
                       'debit_total', round(v_total_debit, 2), 'credit_total', round(v_total_credit, 2)));

  RETURN v_entry_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public._fifo_adjust_sale_cogs_delta(p_sale_id uuid, p_delta numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_row public.raw_fifo_sale_cogs_adjustments%ROWTYPE;
  v_target_posted numeric(18,2);
  v_post_delta numeric(18,2);
  v_entry_id uuid;
  v_entry_number text;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_existing_inventory_account uuid;
  v_cogs_line bigint;
  v_inventory_line bigint;
  v_base_cogs numeric(18,6):=0;
BEGIN
  IF p_sale_id IS NULL OR COALESCE(p_delta,0) = 0 THEN
    RETURN jsonb_build_object('success',true,'posted_delta',0);
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id=p_sale_id
  FOR SHARE;

  IF v_sale.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_SALE_NOT_FOUND');
  END IF;

  SELECT COALESCE(sum(jl.debit-jl.credit),0)
  INTO v_base_cogs
  FROM public.journal_entries je
  JOIN public.account_mappings am
    ON am.branch_id=v_sale.branch_id AND am.semantic_key='cogs'
  JOIN public.journal_entry_lines jl
    ON jl.journal_entry_id=je.id AND jl.account_id=am.account_id
  WHERE je.branch_id=v_sale.branch_id
    AND je.reference_id=v_sale.id
    AND je.reference_type='sale';

  INSERT INTO public.raw_fifo_sale_cogs_adjustments(
    sale_id,branch_id,exact_delta,posted_delta
  ) VALUES (
    v_sale.id,v_sale.branch_id,p_delta,0
  )
  ON CONFLICT (sale_id) DO UPDATE
  SET exact_delta=public.raw_fifo_sale_cogs_adjustments.exact_delta+EXCLUDED.exact_delta,
      updated_at=now()
  RETURNING * INTO v_row;

  IF v_base_cogs+v_row.exact_delta < -0.005 THEN
    RAISE EXCEPTION 'FIFO_SALE_COGS_NEGATIVE sale=% base=% delta=%',
      v_sale.id,v_base_cogs,v_row.exact_delta;
  END IF;

  v_target_posted:=round(v_row.exact_delta,2);
  v_post_delta:=v_target_posted-v_row.posted_delta;

  IF v_target_posted=0 THEN
    v_entry_id:=v_row.journal_entry_id;

    IF v_entry_id IS NOT NULL THEN
      DELETE FROM public.journal_entries
      WHERE id=v_entry_id
        AND reference_type='fifo_cogs_reconcile';
    END IF;

    DELETE FROM public.raw_fifo_sale_cogs_adjustments
    WHERE sale_id=v_sale.id;

    RETURN jsonb_build_object(
      'success',true,
      'exact_delta',0,
      'posted_delta',0,
      'journal_entry_id',NULL
    );
  END IF;

  IF v_post_delta=0 THEN
    RETURN jsonb_build_object(
      'success',true,
      'exact_delta',v_row.exact_delta,
      'posted_delta',v_row.posted_delta
    );
  END IF;

  v_entry_id:=v_row.journal_entry_id;

  IF v_entry_id IS NULL THEN
    v_entry_number:=(public.next_document_number('journal')->>'number')::text;

    INSERT INTO public.journal_entries(
      entry_number,branch_id,entry_date,reference_type,reference_id,
      reference_number,description,created_by
    ) VALUES (
      v_entry_number,
      v_sale.branch_id,
      (v_sale.created_at AT TIME ZONE 'Africa/Cairo')::date,
      'fifo_cogs_reconcile',
      v_sale.id,
      v_sale.invoice_number,
      'FIFO COGS reconciliation '||COALESCE(v_sale.invoice_number,v_sale.id::text),
      auth.uid()
    )
    RETURNING id INTO v_entry_id;

    UPDATE public.raw_fifo_sale_cogs_adjustments
    SET journal_entry_id=v_entry_id
    WHERE sale_id=v_sale.id;
  END IF;

  SELECT account_id INTO v_cogs_account
  FROM public.account_mappings
  WHERE branch_id=v_sale.branch_id AND semantic_key='cogs';

  -- Reconcile against the same inventory account used by the base sale.
  -- Historical 1200 sales stay on 1200; new raw-material sales use 1210.
  SELECT jl.account_id
  INTO v_inventory_account
  FROM public.journal_entries je
  JOIN public.journal_entry_lines jl
    ON jl.journal_entry_id=je.id
  JOIN public.account_mappings am
    ON am.branch_id=v_sale.branch_id
   AND am.account_id=jl.account_id
   AND am.semantic_key IN ('inventory_rm','inventory_fg')
  WHERE je.branch_id=v_sale.branch_id
    AND je.reference_id=v_sale.id
    AND je.reference_type='sale'
    AND jl.credit > jl.debit
  ORDER BY CASE am.semantic_key WHEN 'inventory_rm' THEN 0 ELSE 1 END
  LIMIT 1;

  -- If this reconciliation journal already exists, never switch its account.
  IF v_entry_id IS NOT NULL THEN
    SELECT jl.account_id
    INTO v_existing_inventory_account
    FROM public.journal_entry_lines jl
    JOIN public.account_mappings am
      ON am.branch_id=v_sale.branch_id
     AND am.account_id=jl.account_id
     AND am.semantic_key IN ('inventory_rm','inventory_fg')
    WHERE jl.journal_entry_id=v_entry_id
    ORDER BY CASE am.semantic_key WHEN 'inventory_rm' THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_existing_inventory_account IS NOT NULL THEN
      v_inventory_account:=v_existing_inventory_account;
    END IF;
  END IF;

  IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
    RAISE EXCEPTION 'FIFO_ACCOUNT_MAPPING_MISSING branch=%',v_sale.branch_id;
  END IF;

  SELECT id INTO v_cogs_line
  FROM public.journal_entry_lines
  WHERE journal_entry_id=v_entry_id AND account_id=v_cogs_account
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_cogs_line IS NULL THEN
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES (
      v_entry_id,v_cogs_account,
      GREATEST(v_target_posted,0),
      GREATEST(-v_target_posted,0),
      'FIFO COGS reconciliation'
    )
    RETURNING id INTO v_cogs_line;
  ELSE
    UPDATE public.journal_entry_lines
    SET debit=GREATEST(v_target_posted,0),
        credit=GREATEST(-v_target_posted,0)
    WHERE id=v_cogs_line;
  END IF;

  SELECT id INTO v_inventory_line
  FROM public.journal_entry_lines
  WHERE journal_entry_id=v_entry_id AND account_id=v_inventory_account
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_inventory_line IS NULL THEN
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES (
      v_entry_id,v_inventory_account,
      GREATEST(-v_target_posted,0),
      GREATEST(v_target_posted,0),
      'FIFO inventory reconciliation'
    )
    RETURNING id INTO v_inventory_line;
  ELSE
    UPDATE public.journal_entry_lines
    SET debit=GREATEST(-v_target_posted,0),
        credit=GREATEST(v_target_posted,0)
    WHERE id=v_inventory_line;
  END IF;

  UPDATE public.raw_fifo_sale_cogs_adjustments
  SET posted_delta=v_target_posted,
      updated_at=now()
  WHERE sale_id=v_sale.id;

  RETURN jsonb_build_object(
    'success',true,
    'exact_delta',v_row.exact_delta,
    'posted_delta',v_target_posted,
    'journal_entry_id',v_entry_id
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public._fifo_adjust_orphan_sale_cogs_delta(p_sale_id uuid, p_branch_id uuid, p_delta numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_base_entry public.journal_entries%ROWTYPE;
  v_base_count integer:=0;
  v_row public.raw_fifo_orphan_sale_cogs_adjustments%ROWTYPE;
  v_target_posted numeric(18,2);
  v_post_delta numeric(18,2);
  v_entry_id uuid;
  v_entry_number text;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_existing_inventory_account uuid;
  v_cogs_line bigint;
  v_inventory_line bigint;
  v_base_cogs numeric(18,6):=0;
BEGIN
  IF p_sale_id IS NULL OR p_branch_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'posted_delta',0);
  END IF;

  IF EXISTS (SELECT 1 FROM public.sales s WHERE s.id=p_sale_id) THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_ORPHAN_SALE_HEADER_STILL_EXISTS',
      'sale_id',p_sale_id
    );
  END IF;

  SELECT count(*) INTO v_base_count
  FROM public.journal_entries je
  WHERE je.branch_id=p_branch_id
    AND je.reference_type='sale'
    AND je.reference_id=p_sale_id;

  IF v_base_count<>1 THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_ORPHAN_SALE_JOURNAL_AMBIGUOUS',
      'sale_id',p_sale_id,
      'branch_id',p_branch_id,
      'journal_matches',v_base_count
    );
  END IF;

  SELECT * INTO v_base_entry
  FROM public.journal_entries je
  WHERE je.branch_id=p_branch_id
    AND je.reference_type='sale'
    AND je.reference_id=p_sale_id
  LIMIT 1
  FOR SHARE;

  IF EXISTS (
    SELECT 1
    FROM public.raw_fifo_sale_cogs_adjustments a
    WHERE a.sale_id=p_sale_id
  ) THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_ORPHAN_SALE_NORMAL_ADJUSTMENT_EXISTS',
      'sale_id',p_sale_id
    );
  END IF;

  SELECT account_id INTO v_cogs_account
  FROM public.account_mappings
  WHERE branch_id=p_branch_id AND semantic_key='cogs';

  -- The orphan still has its original sale journal, so derive the exact
  -- inventory account from that journal instead of imposing a new mapping.
  SELECT jl.account_id
  INTO v_inventory_account
  FROM public.journal_entry_lines jl
  JOIN public.account_mappings am
    ON am.branch_id=p_branch_id
   AND am.account_id=jl.account_id
   AND am.semantic_key IN ('inventory_rm','inventory_fg')
  WHERE jl.journal_entry_id=v_base_entry.id
    AND jl.credit > jl.debit
  ORDER BY CASE am.semantic_key WHEN 'inventory_rm' THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_ORPHAN_SALE_ACCOUNT_MAPPING_MISSING',
      'branch_id',p_branch_id
    );
  END IF;

  SELECT COALESCE(sum(jl.debit-jl.credit),0)
  INTO v_base_cogs
  FROM public.journal_entry_lines jl
  WHERE jl.journal_entry_id=v_base_entry.id
    AND jl.account_id=v_cogs_account;

  INSERT INTO public.raw_fifo_orphan_sale_cogs_adjustments(
    sale_id,branch_id,exact_delta,posted_delta
  ) VALUES (
    p_sale_id,p_branch_id,p_delta,0
  )
  ON CONFLICT (sale_id) DO UPDATE
  SET exact_delta=public.raw_fifo_orphan_sale_cogs_adjustments.exact_delta+EXCLUDED.exact_delta,
      updated_at=now()
  RETURNING * INTO v_row;

  IF v_row.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION
      'FIFO_ORPHAN_SALE_BRANCH_MISMATCH sale=% existing=% requested=%',
      p_sale_id,v_row.branch_id,p_branch_id;
  END IF;

  IF v_base_cogs+v_row.exact_delta < -0.005 THEN
    RAISE EXCEPTION
      'FIFO_ORPHAN_SALE_COGS_NEGATIVE sale=% base=% delta=%',
      p_sale_id,v_base_cogs,v_row.exact_delta;
  END IF;

  v_target_posted:=round(v_row.exact_delta,2);
  v_post_delta:=v_target_posted-v_row.posted_delta;

  IF v_target_posted=0 THEN
    v_entry_id:=v_row.journal_entry_id;

    IF v_entry_id IS NOT NULL THEN
      DELETE FROM public.journal_entries
      WHERE id=v_entry_id
        AND reference_type='fifo_cogs_reconcile'
        AND reference_id=p_sale_id;
    END IF;

    DELETE FROM public.raw_fifo_orphan_sale_cogs_adjustments
    WHERE sale_id=p_sale_id;

    RETURN jsonb_build_object(
      'success',true,
      'exact_delta',0,
      'posted_delta',0,
      'journal_entry_id',NULL,
      'orphan_sale',true
    );
  END IF;

  IF v_post_delta=0 THEN
    RETURN jsonb_build_object(
      'success',true,
      'exact_delta',v_row.exact_delta,
      'posted_delta',v_row.posted_delta,
      'journal_entry_id',v_row.journal_entry_id,
      'orphan_sale',true
    );
  END IF;

  v_entry_id:=v_row.journal_entry_id;

  -- If this reconciliation journal already exists, never switch its account.
  IF v_entry_id IS NOT NULL THEN
    SELECT jl.account_id
    INTO v_existing_inventory_account
    FROM public.journal_entry_lines jl
    JOIN public.account_mappings am
      ON am.branch_id=p_branch_id
     AND am.account_id=jl.account_id
     AND am.semantic_key IN ('inventory_rm','inventory_fg')
    WHERE jl.journal_entry_id=v_entry_id
    ORDER BY CASE am.semantic_key WHEN 'inventory_rm' THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_existing_inventory_account IS NOT NULL THEN
      v_inventory_account:=v_existing_inventory_account;
    END IF;
  END IF;

  IF v_entry_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.branch_id=p_branch_id
        AND je.reference_type='fifo_cogs_reconcile'
        AND je.reference_id=p_sale_id
    ) THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_ORPHAN_SALE_RECONCILE_JOURNAL_ALREADY_EXISTS',
        'sale_id',p_sale_id
      );
    END IF;

    v_entry_number:=(public.next_document_number('journal')->>'number')::text;

    INSERT INTO public.journal_entries(
      entry_number,branch_id,entry_date,reference_type,reference_id,
      reference_number,description,created_by
    ) VALUES (
      v_entry_number,
      p_branch_id,
      v_base_entry.entry_date,
      'fifo_cogs_reconcile',
      p_sale_id,
      v_base_entry.reference_number,
      'FIFO orphan sale COGS reconciliation '
        ||COALESCE(v_base_entry.reference_number,p_sale_id::text),
      COALESCE(auth.uid(),v_base_entry.created_by)
    )
    RETURNING id INTO v_entry_id;

    UPDATE public.raw_fifo_orphan_sale_cogs_adjustments
    SET journal_entry_id=v_entry_id
    WHERE sale_id=p_sale_id;
  END IF;

  SELECT id INTO v_cogs_line
  FROM public.journal_entry_lines
  WHERE journal_entry_id=v_entry_id AND account_id=v_cogs_account
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_cogs_line IS NULL THEN
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES (
      v_entry_id,v_cogs_account,
      GREATEST(v_target_posted,0),
      GREATEST(-v_target_posted,0),
      'FIFO orphan sale COGS reconciliation'
    )
    RETURNING id INTO v_cogs_line;
  ELSE
    UPDATE public.journal_entry_lines
    SET debit=GREATEST(v_target_posted,0),
        credit=GREATEST(-v_target_posted,0)
    WHERE id=v_cogs_line;
  END IF;

  SELECT id INTO v_inventory_line
  FROM public.journal_entry_lines
  WHERE journal_entry_id=v_entry_id AND account_id=v_inventory_account
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_inventory_line IS NULL THEN
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES (
      v_entry_id,v_inventory_account,
      GREATEST(-v_target_posted,0),
      GREATEST(v_target_posted,0),
      'FIFO orphan sale inventory reconciliation'
    )
    RETURNING id INTO v_inventory_line;
  ELSE
    UPDATE public.journal_entry_lines
    SET debit=GREATEST(-v_target_posted,0),
        credit=GREATEST(v_target_posted,0)
    WHERE id=v_inventory_line;
  END IF;

  UPDATE public.raw_fifo_orphan_sale_cogs_adjustments
  SET posted_delta=v_target_posted,
      updated_at=now()
  WHERE sale_id=p_sale_id;

  RETURN jsonb_build_object(
    'success',true,
    'exact_delta',v_row.exact_delta,
    'posted_delta',v_target_posted,
    'journal_entry_id',v_entry_id,
    'base_sale_journal_id',v_base_entry.id,
    'orphan_sale',true
  );
END;
$function$;


COMMIT;
