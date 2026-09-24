-- Safe accounting fallback for historical inventory-ledger sale references
-- whose sale header was deleted but whose original sale journal remains.
-- This migration does not run any repair automatically.
BEGIN;

CREATE TABLE IF NOT EXISTS public.raw_fifo_orphan_sale_cogs_adjustments (
  sale_id uuid PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  exact_delta numeric(18,6) NOT NULL DEFAULT 0,
  posted_delta numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.raw_fifo_orphan_sale_cogs_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raw_fifo_orphan_sale_cogs_adjustments
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.raw_fifo_orphan_sale_cogs_adjustments
  TO service_role,postgres;

CREATE OR REPLACE FUNCTION public._fifo_adjust_orphan_sale_cogs_delta(
  p_sale_id uuid,
  p_branch_id uuid,
  p_delta numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
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

  SELECT account_id INTO v_inventory_account
  FROM public.account_mappings
  WHERE branch_id=p_branch_id AND semantic_key='inventory_fg';

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

REVOKE ALL ON FUNCTION public._fifo_adjust_orphan_sale_cogs_delta(uuid,uuid,numeric)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._fifo_adjust_orphan_sale_cogs_delta(uuid,uuid,numeric)
  TO service_role,postgres;


CREATE OR REPLACE FUNCTION public._fifo_adjust_reference_delta(p_reference_type text, p_reference_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_target_type text, p_target_id uuid, p_delta numeric, p_depth integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ref_no text;
  v_entry_date date;
  v_sale_id uuid;
  v_sale_status text;
  v_sale_count integer:=0;
  v_order_count integer:=0;
  v_journal_count integer:=0;
  v_res jsonb;
BEGIN
  IF p_reference_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'delta',0);
  END IF;

  IF p_depth>16 THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_REFERENCE_PROPAGATION_TOO_DEEP');
  END IF;

  IF p_reference_type='sale' THEN
    IF EXISTS (SELECT 1 FROM public.sales s WHERE s.id=p_reference_id) THEN
      RETURN public._fifo_adjust_sale_cogs_delta(p_reference_id,p_delta);
    END IF;

    v_res:=public._fifo_adjust_orphan_sale_cogs_delta(
      p_reference_id,p_branch_id,p_delta
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_res;
    END IF;

    RETURN v_res || jsonb_build_object(
      'orphan_sale_fallback',true,
      'sale_id',p_reference_id
    );

  ELSIF p_reference_type='kitchen_send' THEN
    IF EXISTS (
      SELECT 1
      FROM public.order_kitchen_inventory_events e
      WHERE e.id=p_reference_id
    ) THEN
      RETURN public._fifo_adjust_kitchen_effect_delta(
        p_reference_id,p_target_type,p_target_id,p_delta
      );
    END IF;

    SELECT il.reference_number,(il.created_at AT TIME ZONE 'Africa/Cairo')::date
    INTO v_ref_no,v_entry_date
    FROM public.inventory_ledger il
    WHERE il.reference_type='kitchen_send'
      AND il.reference_id=p_reference_id
      AND il.branch_id=p_branch_id
    ORDER BY il.created_at,il.id
    LIMIT 1;

    IF v_ref_no IS NULL THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_NOT_FOUND',
        'reference_id',p_reference_id
      );
    END IF;

    SELECT count(*)
    INTO v_order_count
    FROM public.orders o
    WHERE o.branch_id=p_branch_id
      AND o.order_number=v_ref_no;

    -- Reuse v_sale_id only after the order guard; it is intentionally ignored
    -- for orders because a missing event with a surviving order is not safe to
    -- infer as settled inventory.
    IF v_order_count>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_MISSING_WITH_LIVE_ORDER',
        'reference_id',p_reference_id,
        'reference_number',v_ref_no,
        'order_matches',v_order_count
      );
    END IF;

    SELECT count(*)
    INTO v_sale_count
    FROM public.sales s
    WHERE s.branch_id=p_branch_id
      AND s.invoice_number=v_ref_no;

    IF v_sale_count=1 THEN
      SELECT s.id,s.status
      INTO v_sale_id,v_sale_status
      FROM public.sales s
      WHERE s.branch_id=p_branch_id
        AND s.invoice_number=v_ref_no
      LIMIT 1;
    END IF;

    SELECT count(*)
    INTO v_journal_count
    FROM public.journal_entries je
    WHERE je.branch_id=p_branch_id
      AND je.reference_id=p_reference_id;

    IF v_journal_count>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_MISSING_WITH_LIVE_REFERENCE',
        'reference_id',p_reference_id,
        'reference_number',v_ref_no,
        'journal_matches',v_journal_count
      );
    END IF;

    IF v_sale_count=1 AND v_sale_status='completed' THEN
      v_res:=public._fifo_adjust_sale_cogs_delta(v_sale_id,p_delta);
      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        RETURN v_res;
      END IF;

      RETURN v_res || jsonb_build_object(
        'historical_sale_fallback',true,
        'missing_kitchen_event_id',p_reference_id,
        'sale_id',v_sale_id,
        'reference_number',v_ref_no,
        'ledger_authoritative',true
      );
    END IF;

    IF v_sale_count>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_MISSING_WITH_AMBIGUOUS_SALE',
        'reference_id',p_reference_id,
        'reference_number',v_ref_no,
        'sale_matches',v_sale_count,
        'sale_status',v_sale_status
      );
    END IF;

    RETURN jsonb_build_object(
      'success',true,
      'delta',p_delta,
      'orphan_reference',true,
      'ledger_only',true,
      'reference_type','kitchen_send',
      'reference_id',p_reference_id,
      'reference_number',v_ref_no
    );

  ELSIF p_reference_type='production' THEN
    RETURN public._fifo_adjust_production_delta(
      p_reference_id,p_delta,p_depth+1
    );

  ELSIF p_reference_type='warehouse_transfer' THEN
    RETURN public._fifo_adjust_warehouse_transfer_delta(
      p_reference_id,p_branch_id,p_warehouse_id,
      p_target_type,p_target_id,p_delta
    );

  ELSIF p_reference_type='purchase_return' THEN
    SELECT invoice_number,(created_at AT TIME ZONE 'Africa/Cairo')::date
    INTO v_ref_no,v_entry_date
    FROM public.purchases
    WHERE id=p_reference_id;

    IF NOT FOUND THEN
      SELECT il.reference_number,(il.created_at AT TIME ZONE 'Africa/Cairo')::date
      INTO v_ref_no,v_entry_date
      FROM public.inventory_ledger il
      WHERE il.reference_type='purchase_return'
        AND il.reference_id=p_reference_id
        AND il.branch_id=p_branch_id
      ORDER BY il.created_at,il.id
      LIMIT 1;
    END IF;

    IF v_ref_no IS NULL THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_PURCHASE_RETURN_REFERENCE_NOT_FOUND',
        'reference_id',p_reference_id
      );
    END IF;

    RETURN public._fifo_adjust_stock_variance_delta(
      p_branch_id,'purchase_return',p_reference_id,
      v_ref_no,v_entry_date,p_delta
    );
  END IF;

  RETURN jsonb_build_object(
    'success',false,
    'error','FIFO_UNSUPPORTED_REFERENCE_TYPE',
    'reference_type',p_reference_type,
    'reference_id',p_reference_id
  );
END;
$function$
;

COMMIT;
