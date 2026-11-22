-- Fail closed on corrected purchase invoices when the original return
-- does not produce a matching GL reversal. This preserves atomic rollback
-- of stock, returned purchase lines and replacement invoice.
-- The historical 00529 anomaly is NOT corrected by this migration.
DO $ledger_guard$
DECLARE
  d text;
  variable_marker text := '  v_tx_timestamp timestamptz := now();';
  return_marker text := '  v_return := public.process_purchase_return(';
  success_marker text := $marker$  IF COALESCE((v_return->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = COALESCE(v_return->>'detail', v_return->>'error', 'PURCHASE_REVERSAL_FAILED'),
      ERRCODE = 'P0001';
  END IF;$marker$;
  additional_variable text := E'\n  v_prior_return_journal_count integer := 0;';
  before_return text := $before$
  SELECT count(*) INTO v_prior_return_journal_count
  FROM public.journal_entries j
  WHERE j.branch_id = v_purchase.branch_id
    AND j.reference_type = 'purchase_return'
    AND j.reference_number = v_purchase.invoice_number;

$before$;
  after_return text := $after$

  -- A full invoice correction must reverse the original purchase posting,
  -- not merely change stock and mark the old invoice returned.
  IF v_purchase.total > 0 AND COALESCE((v_return->>'returned_amount')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'PURCHASE_RETURN_AMOUNT_MISSING';
  END IF;
  IF COALESCE((v_return->>'returned_amount')::numeric, 0) > 0
     AND (SELECT count(*) FROM public.journal_entries j
          WHERE j.branch_id = v_purchase.branch_id
            AND j.reference_type = 'purchase_return'
            AND j.reference_number = v_purchase.invoice_number)
         <= v_prior_return_journal_count THEN
    RAISE EXCEPTION 'PURCHASE_RETURN_JOURNAL_MISSING';
  END IF;$after$;
BEGIN
  d := pg_get_functiondef('public.update_purchase_invoice(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb)'::regprocedure);
  IF strpos(d, 'v_prior_return_journal_count') > 0 THEN RETURN; END IF;
  IF (length(d)-length(replace(d,variable_marker,'')))/length(variable_marker) <> 1
     OR (length(d)-length(replace(d,return_marker,'')))/length(return_marker) <> 1
     OR (length(d)-length(replace(d,success_marker,'')))/length(success_marker) <> 1
  THEN RAISE EXCEPTION 'PURCHASE_CORRECTION_GUARD_SOURCE_DRIFT'; END IF;
  d := replace(d, variable_marker, variable_marker || additional_variable);
  d := replace(d, return_marker, before_return || return_marker);
  d := replace(d, success_marker, success_marker || after_return);
  EXECUTE d;
END $ledger_guard$;
