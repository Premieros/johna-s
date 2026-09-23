BEGIN;

-- Core reports rebuild:
-- 1) make the general ledger readable and account-aware;
-- 2) add a real bank/treasury statement with opening/in/out/running balance;
-- 3) add an item movement statement sourced from the inventory ledger.

CREATE OR REPLACE FUNCTION public.get_general_ledger(
  p_branch_id uuid,
  p_account_id uuid,
  p_from_date date DEFAULT NULL::date,
  p_to_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from date := public.history_clamp_from(p_from_date);
  v_to date := public.history_clamp_to(p_to_date);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.can_permission('reports.financial') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:reports.financial';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts a
    WHERE a.id=p_account_id AND a.branch_id=p_branch_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_BRANCH_MISMATCH';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY row.entry_date,row.entry_number,row.line_id),'[]'::jsonb)
    FROM (
      SELECT
        l.id AS line_id,
        l.account_id,
        a.code AS account_code,
        a.name AS account_name,
        a.name_en AS account_name_en,
        a.account_type,
        j.entry_date,
        j.entry_number,
        j.reference_type,
        j.reference_number,
        j.description,
        l.note,
        round(l.debit,2) AS debit,
        round(l.credit,2) AS credit,
        round(
          SUM(
            CASE WHEN a.account_type IN ('asset','expense')
              THEN l.debit-l.credit
              ELSE l.credit-l.debit
            END
          ) OVER (
            PARTITION BY l.account_id
            ORDER BY j.entry_date,j.entry_number,l.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ),2
        ) AS balance
      FROM public.journal_entry_lines l
      JOIN public.journal_entries j ON j.id=l.journal_entry_id
      JOIN public.chart_of_accounts a ON a.id=l.account_id
      WHERE j.branch_id=p_branch_id
        AND (p_account_id IS NULL OR l.account_id=p_account_id)
        AND (v_from IS NULL OR j.entry_date>=v_from)
        AND (v_to IS NULL OR j.entry_date<=v_to)
        AND private.financial_row_visible(j.id,j.branch_id,j.created_at)
    ) row
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_treasury_account_statement(
  p_branch_id uuid,
  p_treasury_account_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_t public.treasury_accounts%ROWTYPE;
  v_a public.chart_of_accounts%ROWTYPE;
  v_from date := public.history_clamp_from(p_from_date);
  v_to date := public.history_clamp_to(p_to_date);
  v_opening numeric := 0;
  v_in numeric := 0;
  v_out numeric := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('reports.financial') THEN RAISE EXCEPTION 'PERMISSION_DENIED:reports.financial'; END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;

  SELECT * INTO v_t
  FROM public.treasury_accounts
  WHERE id=p_treasury_account_id AND branch_id=p_branch_id AND is_active;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'TREASURY_ACCOUNT_NOT_FOUND'; END IF;

  SELECT * INTO v_a FROM public.chart_of_accounts WHERE id=v_t.account_id;
  IF v_a.id IS NULL THEN RAISE EXCEPTION 'TREASURY_GL_ACCOUNT_NOT_FOUND'; END IF;

  SELECT round(
    COALESCE(v_t.opening_balance,0)
    + COALESCE(SUM(l.debit-l.credit),0),2
  )
  INTO v_opening
  FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id=l.journal_entry_id
  WHERE l.account_id=v_t.account_id
    AND j.branch_id=p_branch_id
    AND (v_from IS NULL OR j.entry_date<v_from)
    AND private.financial_row_visible(j.id,j.branch_id,j.created_at);

  WITH period_rows AS (
    SELECT
      l.id AS line_id,
      j.entry_date,
      j.entry_number,
      j.reference_type,
      j.reference_number,
      j.description,
      l.note,
      round(l.debit,2) AS inflow,
      round(l.credit,2) AS outflow,
      j.created_at
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id=l.journal_entry_id
    WHERE l.account_id=v_t.account_id
      AND j.branch_id=p_branch_id
      AND (v_from IS NULL OR j.entry_date>=v_from)
      AND (v_to IS NULL OR j.entry_date<=v_to)
      AND private.financial_row_visible(j.id,j.branch_id,j.created_at)
  ),
  running AS (
    SELECT
      p.*,
      round(v_opening + SUM(p.inflow-p.outflow) OVER (
        ORDER BY p.entry_date,p.entry_number,p.line_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ),2) AS balance
    FROM period_rows p
  )
  SELECT
    COALESCE(round(SUM(inflow),2),0),
    COALESCE(round(SUM(outflow),2),0),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'line_id',line_id,
        'entry_date',entry_date,
        'entry_number',entry_number,
        'reference_type',reference_type,
        'reference_number',reference_number,
        'description',description,
        'note',note,
        'inflow',inflow,
        'outflow',outflow,
        'balance',balance
      ) ORDER BY entry_date,entry_number,line_id
    ),'[]'::jsonb)
  INTO v_in,v_out,v_rows
  FROM running;

  RETURN jsonb_build_object(
    'treasury_account_id',v_t.id,
    'account_name',v_t.account_name,
    'account_number',v_t.account_number,
    'scope',v_t.scope,
    'kind',v_t.kind,
    'account_code',v_a.code,
    'from_date',v_from,
    'to_date',v_to,
    'opening_balance',v_opening,
    'total_inflow',v_in,
    'total_outflow',v_out,
    'closing_balance',round(v_opening+v_in-v_out,2),
    'rows',v_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_item_statement(
  p_branch_id uuid,
  p_item_type text,
  p_item_id uuid,
  p_warehouse_id uuid DEFAULT NULL::uuid,
  p_from_date date DEFAULT NULL::date,
  p_to_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from date := public.history_clamp_from(p_from_date);
  v_to date := public.history_clamp_to(p_to_date);
  v_name text;
  v_opening numeric := 0;
  v_in numeric := 0;
  v_out numeric := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (public.can_permission('inventory.ledger.view') OR public.can_permission('reports.financial')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:inventory.ledger.view';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;
  IF p_item_type NOT IN ('product','raw_material') THEN RAISE EXCEPTION 'INVALID_ITEM_TYPE'; END IF;

  IF p_item_type='product' THEN
    SELECT name INTO v_name FROM public.products WHERE id=p_item_id AND branch_id=p_branch_id;
  ELSE
    SELECT name INTO v_name FROM public.raw_materials WHERE id=p_item_id AND branch_id=p_branch_id;
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;

  SELECT round(COALESCE(SUM(il.quantity),0),4)
  INTO v_opening
  FROM public.inventory_ledger il
  WHERE il.branch_id=p_branch_id
    AND (p_warehouse_id IS NULL OR il.warehouse_id=p_warehouse_id)
    AND ((p_item_type='product' AND il.product_id=p_item_id) OR (p_item_type='raw_material' AND il.raw_material_id=p_item_id))
    AND (v_from IS NULL OR (il.created_at AT TIME ZONE 'Africa/Cairo')::date<v_from)
    AND private.financial_reference_visible(
      il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at
    );

  WITH period_rows AS (
    SELECT
      il.id,
      il.created_at,
      il.entry_type,
      il.reference_type,
      il.reference_id,
      il.reference_number,
      il.batch_number,
      il.warehouse_id,
      w.name AS warehouse_name,
      round(il.quantity,4) AS quantity,
      round(il.unit_cost,4) AS unit_cost,
      round(il.total_cost,2) AS total_cost,
      il.before_qty,
      il.after_qty
    FROM public.inventory_ledger il
    LEFT JOIN public.warehouses w ON w.id=il.warehouse_id
    WHERE il.branch_id=p_branch_id
      AND (p_warehouse_id IS NULL OR il.warehouse_id=p_warehouse_id)
      AND ((p_item_type='product' AND il.product_id=p_item_id) OR (p_item_type='raw_material' AND il.raw_material_id=p_item_id))
      AND (v_from IS NULL OR (il.created_at AT TIME ZONE 'Africa/Cairo')::date>=v_from)
      AND (v_to IS NULL OR (il.created_at AT TIME ZONE 'Africa/Cairo')::date<=v_to)
      AND private.financial_reference_visible(
        il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at
      )
  ),
  running AS (
    SELECT
      p.*,
      round(v_opening + SUM(p.quantity) OVER (
        ORDER BY p.created_at,p.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ),4) AS balance
    FROM period_rows p
  )
  SELECT
    COALESCE(round(SUM(GREATEST(quantity,0)),4),0),
    COALESCE(round(SUM(GREATEST(-quantity,0)),4),0),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',id,
        'created_at',created_at,
        'entry_type',entry_type,
        'reference_type',reference_type,
        'reference_id',reference_id,
        'reference_number',reference_number,
        'batch_number',batch_number,
        'warehouse_id',warehouse_id,
        'warehouse_name',warehouse_name,
        'quantity',quantity,
        'in_qty',GREATEST(quantity,0),
        'out_qty',GREATEST(-quantity,0),
        'unit_cost',unit_cost,
        'total_cost',total_cost,
        'before_qty',before_qty,
        'after_qty',after_qty,
        'balance',balance
      ) ORDER BY created_at,id
    ),'[]'::jsonb)
  INTO v_in,v_out,v_rows
  FROM running;

  RETURN jsonb_build_object(
    'item_type',p_item_type,
    'item_id',p_item_id,
    'item_name',v_name,
    'warehouse_id',p_warehouse_id,
    'from_date',v_from,
    'to_date',v_to,
    'opening_quantity',v_opening,
    'total_in',v_in,
    'total_out',v_out,
    'closing_quantity',round(v_opening+v_in-v_out,4),
    'rows',v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_general_ledger(uuid,uuid,date,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_treasury_account_statement(uuid,uuid,date,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_inventory_item_statement(uuid,text,uuid,uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_general_ledger(uuid,uuid,date,date) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_treasury_account_statement(uuid,uuid,date,date) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_item_statement(uuid,text,uuid,uuid,date,date) TO authenticated,service_role;

COMMIT;
