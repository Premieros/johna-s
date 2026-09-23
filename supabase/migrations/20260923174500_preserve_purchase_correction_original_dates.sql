-- Purchase invoice corrections must remain on the original document date.
-- Fixes both future corrections and historical correction chains.
-- Audit log timestamps are intentionally preserved as the true edit time.

CREATE OR REPLACE FUNCTION public.update_purchase_invoice(
  p_purchase_id uuid,
  p_supplier_id uuid,
  p_warehouse_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_tax_amount numeric,
  p_total numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_purchase public.purchases%ROWTYPE;
  v_return jsonb;
  v_replacement jsonb;
  v_revision_number text;
  v_original_created_at timestamptz;
  v_original_entry_date date;
  v_replacement_id uuid;
  v_tx_timestamp timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('purchases.manage') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_ALLOWED',
      'detail', 'purchases.manage permission is required.'
    );
  END IF;

  -- Read first without taking a row lock so callers must pass branch access and
  -- lifecycle/editability checks before they are allowed to lock the invoice.
  SELECT *
  INTO v_purchase
  FROM public.purchases
  WHERE id = p_purchase_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_purchase.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  -- Editing lifecycle states that are still awaiting approval/receiving would
  -- bypass their workflow. Completed invoices are corrected through a full
  -- reversal followed by a replacement in this same database transaction.
  IF v_purchase.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PURCHASE_EDIT_STATUS_NOT_ALLOWED',
      'detail', 'Only completed purchase invoices can be corrected here.'
    );
  END IF;

  -- Lock only after the caller has been authorized and the invoice is known to
  -- be editable. Re-read under the lock, then repeat critical checks to guard
  -- against a branch/status change between the initial read and lock acquisition.
  SELECT *
  INTO v_purchase
  FROM public.purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_purchase.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_purchase.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PURCHASE_EDIT_STATUS_NOT_ALLOWED',
      'detail', 'Only completed purchase invoices can be corrected here.'
    );
  END IF;

  -- Corrections are revisions of the same financial document, not new-day purchases.
  -- Resolve the root timestamp across the visible invoice and all of its audit revisions.
  SELECT MIN(p.created_at)
  INTO v_original_created_at
  FROM public.purchases p
  WHERE p.branch_id = v_purchase.branch_id
    AND (
      p.invoice_number = v_purchase.invoice_number
      OR left(p.invoice_number, length(v_purchase.invoice_number) + 5) = v_purchase.invoice_number || '-REV-'
    );

  v_original_created_at := COALESCE(v_original_created_at, v_purchase.created_at);

  SELECT je.entry_date
  INTO v_original_entry_date
  FROM public.journal_entries je
  JOIN public.purchases p ON p.id = je.reference_id
  WHERE je.branch_id = v_purchase.branch_id
    AND je.reference_type = 'purchase'
    AND (
      p.invoice_number = v_purchase.invoice_number
      OR left(p.invoice_number, length(v_purchase.invoice_number) + 5) = v_purchase.invoice_number || '-REV-'
    )
  ORDER BY p.created_at ASC, je.created_at ASC
  LIMIT 1;

  v_original_entry_date := COALESCE(
    v_original_entry_date,
    (v_original_created_at AT TIME ZONE 'Africa/Cairo')::date
  );

  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_REQUIRED');
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_ITEMS_REQUIRED');
  END IF;

  IF p_total IS NULL OR p_total < 0 OR p_subtotal IS NULL OR p_subtotal < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOTAL');
  END IF;

  -- Keep branch immutable. Warehouse may be corrected, but if supplied it must
  -- belong to the same branch. process_purchase performs its own validation too.
  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.branch_id = v_purchase.branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  v_return := public.process_purchase_return(
    p_purchase_id => p_purchase_id,
    p_items => NULL,
    p_reason => 'Purchase invoice corrected'
  );

  IF COALESCE((v_return->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = COALESCE(v_return->>'detail', v_return->>'error', 'PURCHASE_REVERSAL_FAILED'),
      ERRCODE = 'P0001';
  END IF;

  -- Free the visible invoice number for the replacement while retaining the old
  -- returned row as an auditable revision. The suffix uses the row id so it is
  -- deterministic and unique without allocating another financial document no.
  v_revision_number := v_purchase.invoice_number || '-REV-' || substr(replace(p_purchase_id::text, '-', ''), 1, 8);
  UPDATE public.purchases
  SET invoice_number = v_revision_number
  WHERE id = p_purchase_id;

  v_replacement := public.process_purchase(
    p_invoice_number => v_purchase.invoice_number,
    p_supplier_id => p_supplier_id,
    p_branch_id => v_purchase.branch_id,
    p_warehouse_id => p_warehouse_id,
    p_subtotal => p_subtotal,
    p_discount_amount => COALESCE(p_discount_amount, 0),
    p_tax_amount => COALESCE(p_tax_amount, 0),
    p_total => p_total,
    p_paid_amount => COALESCE(p_paid_amount, 0),
    p_payment_method => p_payment_method,
    p_status => 'completed',
    p_notes => p_notes,
    p_items => p_items
  );

  IF COALESCE((v_replacement->>'success')::boolean, false) IS NOT TRUE THEN
    -- Raising after the successful reversal intentionally rolls back the entire
    -- outer transaction, including the reversal and revision-number change.
    RAISE EXCEPTION USING
      MESSAGE = COALESCE(v_replacement->>'detail', v_replacement->>'error', 'PURCHASE_REPLACEMENT_FAILED'),
      ERRCODE = 'P0001';
  END IF;

  v_replacement_id := (v_replacement->>'purchase_id')::uuid;

  -- Keep the corrected document and all accounting/inventory effects on the
  -- original document date. Only audit_log records the actual correction time.
  UPDATE public.purchases
  SET created_at = v_original_created_at
  WHERE id = v_replacement_id;

  UPDATE public.purchase_items
  SET created_at = v_original_created_at
  WHERE purchase_id = v_replacement_id;

  UPDATE public.inventory_batches
  SET created_at = v_original_created_at
  WHERE source_type = 'purchase'
    AND source_id = v_replacement_id;

  UPDATE public.raw_material_batches
  SET created_at = v_original_created_at
  WHERE source_type = 'purchase'
    AND source_id = v_replacement_id;

  UPDATE public.inventory_ledger
  SET created_at = v_original_created_at
  WHERE (
      reference_type = 'purchase'
      AND reference_id = v_replacement_id
    )
    OR (
      reference_type = 'purchase_return'
      AND reference_id = p_purchase_id
      AND created_at = v_tx_timestamp
    );

  UPDATE public.journal_entry_lines jel
  SET created_at = v_original_created_at
  WHERE jel.journal_entry_id IN (
    SELECT je.id
    FROM public.journal_entries je
    WHERE je.branch_id = v_purchase.branch_id
      AND (
        (je.reference_type = 'purchase' AND je.reference_id = v_replacement_id)
        OR (
          je.reference_type = 'purchase_return'
          AND je.reference_number = v_purchase.invoice_number
          AND je.created_at = v_tx_timestamp
        )
      )
  );

  UPDATE public.journal_entries je
  SET created_at = v_original_created_at,
      entry_date = v_original_entry_date
  WHERE je.branch_id = v_purchase.branch_id
    AND (
      (je.reference_type = 'purchase' AND je.reference_id = v_replacement_id)
      OR (
        je.reference_type = 'purchase_return'
        AND je.reference_number = v_purchase.invoice_number
        AND je.created_at = v_tx_timestamp
      )
    );

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    'update',
    'purchase',
    COALESCE((v_replacement->>'purchase_id')::uuid, p_purchase_id),
    jsonb_build_object(
      'previous_purchase_id', p_purchase_id,
      'previous_revision_number', v_revision_number,
      'invoice_number', v_purchase.invoice_number,
      'transactional_reversal', true,
      'original_document_created_at', v_original_created_at,
      'original_entry_date', v_original_entry_date
    ),
    v_purchase.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'purchase_id', v_replacement->>'purchase_id',
    'previous_purchase_id', p_purchase_id,
    'invoice_number', v_purchase.invoice_number,
    'previous_revision_number', v_revision_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_purchase_invoice(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_invoice(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) TO authenticated, service_role;


-- Preserve original business/accounting dates for historical purchase corrections
-- already created by update_purchase_invoice. Audit timestamps remain untouched.
CREATE TEMP TABLE _purchase_correction_audit_map ON COMMIT DROP AS
SELECT
  a.branch_id,
  a.created_at AS correction_at,
  (a.details->>'previous_purchase_id')::uuid AS previous_purchase_id,
  a.entity_id AS replacement_purchase_id,
  a.details->>'invoice_number' AS base_invoice
FROM public.audit_log a
WHERE a.entity = 'purchase'
  AND a.action = 'update'
  AND COALESCE((a.details->>'transactional_reversal')::boolean, false)
  AND a.details ? 'previous_purchase_id'
  AND a.details ? 'invoice_number';

CREATE TEMP TABLE _purchase_correction_roots ON COMMIT DROP AS
WITH chains AS (
  SELECT DISTINCT
    m.branch_id,
    m.base_invoice,
    p.id AS purchase_id,
    p.created_at
  FROM _purchase_correction_audit_map m
  JOIN public.purchases p
    ON p.branch_id = m.branch_id
   AND (
     p.invoice_number = m.base_invoice
     OR left(p.invoice_number, length(m.base_invoice) + 5) = m.base_invoice || '-REV-'
   )
),
ranked AS (
  SELECT *,
         row_number() OVER (PARTITION BY branch_id, base_invoice ORDER BY created_at, purchase_id) AS rn
  FROM chains
)
SELECT
  r.branch_id,
  r.base_invoice,
  r.purchase_id AS root_purchase_id,
  r.created_at AS original_created_at,
  COALESCE(
    (
      SELECT je.entry_date
      FROM public.journal_entries je
      WHERE je.branch_id = r.branch_id
        AND je.reference_type = 'purchase'
        AND je.reference_id = r.purchase_id
      ORDER BY je.created_at
      LIMIT 1
    ),
    (r.created_at AT TIME ZONE 'Africa/Cairo')::date
  ) AS original_entry_date
FROM ranked r
WHERE r.rn = 1;

CREATE TEMP TABLE _purchase_correction_chain_rows ON COMMIT DROP AS
SELECT DISTINCT
  roots.branch_id,
  roots.base_invoice,
  roots.original_created_at,
  roots.original_entry_date,
  p.id AS purchase_id
FROM _purchase_correction_roots roots
JOIN public.purchases p
  ON p.branch_id = roots.branch_id
 AND (
   p.invoice_number = roots.base_invoice
   OR left(p.invoice_number, length(roots.base_invoice) + 5) = roots.base_invoice || '-REV-'
 );

UPDATE public.purchase_items pi
SET created_at = c.original_created_at
FROM _purchase_correction_chain_rows c
WHERE pi.purchase_id = c.purchase_id;

UPDATE public.inventory_batches b
SET created_at = c.original_created_at
FROM _purchase_correction_chain_rows c
WHERE b.source_type = 'purchase'
  AND b.source_id = c.purchase_id;

UPDATE public.raw_material_batches b
SET created_at = c.original_created_at
FROM _purchase_correction_chain_rows c
WHERE b.source_type = 'purchase'
  AND b.source_id = c.purchase_id;

UPDATE public.inventory_ledger il
SET created_at = c.original_created_at
FROM _purchase_correction_chain_rows c
WHERE il.reference_type = 'purchase'
  AND il.reference_id = c.purchase_id;

UPDATE public.inventory_ledger il
SET created_at = roots.original_created_at
FROM _purchase_correction_audit_map m
JOIN _purchase_correction_roots roots
  ON roots.branch_id = m.branch_id
 AND roots.base_invoice = m.base_invoice
WHERE il.reference_type = 'purchase_return'
  AND il.reference_id = m.previous_purchase_id
  AND il.created_at = m.correction_at;

UPDATE public.journal_entry_lines jel
SET created_at = roots.original_created_at
FROM public.journal_entries je
JOIN _purchase_correction_roots roots
  ON roots.branch_id = je.branch_id
JOIN _purchase_correction_audit_map m
  ON m.branch_id = roots.branch_id
 AND m.base_invoice = roots.base_invoice
WHERE jel.journal_entry_id = je.id
  AND (
    (je.reference_type = 'purchase' AND EXISTS (
      SELECT 1
      FROM _purchase_correction_chain_rows c
      WHERE c.purchase_id = je.reference_id
        AND c.branch_id = roots.branch_id
        AND c.base_invoice = roots.base_invoice
    ))
    OR (
      je.reference_type = 'purchase_return'
      AND je.reference_number = roots.base_invoice
      AND je.created_at = m.correction_at
    )
  );

UPDATE public.journal_entries je
SET created_at = roots.original_created_at,
    entry_date = roots.original_entry_date
FROM _purchase_correction_roots roots
WHERE je.branch_id = roots.branch_id
  AND (
    (je.reference_type = 'purchase' AND EXISTS (
      SELECT 1
      FROM _purchase_correction_chain_rows c
      WHERE c.purchase_id = je.reference_id
        AND c.branch_id = roots.branch_id
        AND c.base_invoice = roots.base_invoice
    ))
    OR (
      je.reference_type = 'purchase_return'
      AND je.reference_number = roots.base_invoice
      AND EXISTS (
        SELECT 1
        FROM _purchase_correction_audit_map m
        WHERE m.branch_id = roots.branch_id
          AND m.base_invoice = roots.base_invoice
          AND m.correction_at = je.created_at
      )
    )
  );

UPDATE public.purchases p
SET created_at = c.original_created_at
FROM _purchase_correction_chain_rows c
WHERE p.id = c.purchase_id;

