-- STAGED CANDIDATE ONLY. Not an applied production migration.
-- Run transactionally on an owned test DB. Production needs a CLI-created
-- migration, exact-head verification and separate owner release approval.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $patch$
DECLARE v_def text; v_original text; v_replacement text;
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.set_kitchen_status(uuid,text)'::regprocedure))<>'c34ca506adbfe3b710261789ae2a961c'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_shift_closing_report(uuid)'::regprocedure))<>'8fb54eaf1c7e782b642ab7bbddf64dd6' THEN
  RAISE EXCEPTION 'PRODUCTION_AUDIT_BASELINE_CHANGED';
 END IF;
 SELECT pg_get_functiondef('public.set_kitchen_status(uuid,text)'::regprocedure) INTO v_def;
 v_def:=replace(v_def,'  v_branch_id uuid;','  v_branch_id uuid;
  v_current_status text;');
 v_def:=replace(v_def,'IF p_status NOT IN','IF p_status IS NULL OR p_status NOT IN');
 v_original:='  SELECT o.branch_id INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;';
 v_replacement:='  -- Serialize the order before touching served-quantity rows. Send/settle
  -- already lock the order first; keep the same order to avoid inversion.
  SELECT o.branch_id,o.kitchen_status INTO v_branch_id,v_current_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;';
 IF position(v_original in v_def)=0 THEN RAISE EXCEPTION 'KDS_LOCK_PATCH_TARGET_CHANGED'; END IF;
 v_def:=replace(v_def,v_original,v_replacement);
 v_def:=replace(v_def,'  IF p_status = ''served'' THEN','  -- Authorization above still runs for repeated/no-op requests.
  IF v_current_status IS NOT DISTINCT FROM p_status THEN RETURN; END IF;

  IF p_status = ''served'' THEN');
 EXECUTE v_def;
 -- Preserve owner, ACL, invoker/definer mode and all report permission checks.
 SELECT pg_get_functiondef('public.get_shift_closing_report(uuid)'::regprocedure) INTO v_def;
 v_original:='    SELECT t.id,t.account_name,t.opening_balance,
           round(t.opening_balance+COALESCE(sum(l.debit-l.credit),0),2) gl_balance
    FROM public.treasury_accounts t
    LEFT JOIN public.journal_entry_lines l ON l.account_id=t.account_id
    WHERE t.branch_id=v_shift.branch_id
    GROUP BY t.id,t.account_name,t.opening_balance';
 v_replacement:='    SELECT t.id,t.account_name,t.opening_balance,
           round(t.opening_balance+COALESCE(balance.net,0),2) gl_balance
    FROM public.treasury_accounts t
    LEFT JOIN LATERAL (
      SELECT sum(l.debit-l.credit) net
      FROM public.journal_entry_lines l
      WHERE l.account_id=t.account_id
    ) balance ON true
    WHERE t.branch_id=v_shift.branch_id';
 IF position(v_original in v_def)=0 THEN RAISE EXCEPTION 'SHIFT_TREASURY_PATCH_TARGET_CHANGED'; END IF;
 EXECUTE replace(v_def,v_original,v_replacement);
END $patch$;

-- The negative-issue index is already deployed. Optimize only the two
-- remaining fallbacks, with exactly the current predicates and ordering.
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_priced_receipt_recent
 ON public.inventory_ledger(raw_material_id,branch_id,warehouse_id,created_at DESC NULLS LAST,id DESC)
 INCLUDE(unit_cost)
 WHERE quantity>0 AND COALESCE(unit_cost,0)>0
 AND (COALESCE(entry_type,'')='purchase' OR COALESCE(reference_type,'') IN ('purchase','purchase_receipt'));
CREATE INDEX IF NOT EXISTS idx_raw_batches_real_price_recent
 ON public.raw_material_batches(raw_material_id,branch_id,warehouse_id,created_at DESC NULLS LAST,id DESC)
 INCLUDE(unit_cost)
 WHERE COALESCE(unit_cost,0)>0 AND COALESCE(source_type,'') NOT LIKE '%_oversold';

DO $valid$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.idx_inventory_ledger_priced_receipt_recent'::regclass AND indisvalid AND indisready)
 OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.idx_raw_batches_real_price_recent'::regclass AND indisvalid AND indisready) THEN
  RAISE EXCEPTION 'AUDIT_INDEX_NOT_VALID';
 END IF;
END $valid$;
