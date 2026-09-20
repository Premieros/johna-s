BEGIN;

-- Refund/report integrity:
-- 1) header discounts/tax are allocated proportionally into refund value,
-- 2) a fully returned/cancelled sale contributes zero residual discount to day/shift reports,
-- 3) manual status flips to returned are blocked until line quantities are actually refunded.
-- Printing tables, printer queues and print-audit foreign keys are intentionally untouched.

CREATE OR REPLACE FUNCTION private.sale_report_remaining_ratio(
  p_total numeric,
  p_refunded_amount numeric,
  p_status text
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_status, '')) IN ('returned', 'refunded', 'cancelled') THEN 0::numeric
    WHEN GREATEST(COALESCE(p_total, 0), 0) <= 0 THEN 1::numeric
    ELSE LEAST(
      1::numeric,
      GREATEST(
        0::numeric,
        (GREATEST(COALESCE(p_total, 0), 0) - GREATEST(COALESCE(p_refunded_amount, 0), 0))
        / NULLIF(GREATEST(COALESCE(p_total, 0), 0), 0)
      )
    )
  END;
$$;

REVOKE ALL ON FUNCTION private.sale_report_remaining_ratio(numeric,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sale_report_remaining_ratio(numeric,numeric,text) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.guard_returned_sale_state_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'returned'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_items si WHERE si.sale_id = NEW.id
    ) OR EXISTS (
      SELECT 1
      FROM public.sale_items si
      WHERE si.sale_id = NEW.id
        AND COALESCE(si.refunded_quantity, 0) < COALESCE(si.quantity, 0)
    ) THEN
      RAISE EXCEPTION 'RETURN_STATUS_REQUIRES_REFUND_WORKFLOW';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_returned_sale_state_integrity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_returned_sale_state_integrity() TO service_role, postgres;

DROP TRIGGER IF EXISTS trg_sales_returned_state_integrity ON public.sales;
CREATE TRIGGER trg_sales_returned_state_integrity
BEFORE UPDATE OF status ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.guard_returned_sale_state_integrity();

DO $patch_refund$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef('public._process_refund_single_core(uuid,jsonb,text)'::regprocedure)
    INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '_process_refund_single_core target not found';
  END IF;

  IF position('v_refund_basis numeric(14,2)' in v_def) = 0 THEN
    v_before := v_def;
    v_def := replace(
      v_def,
      $old$  v_refund_total numeric(14,2) := 0;$old$,
      $new$  v_refund_total numeric(14,2) := 0;
  v_refund_basis numeric(14,2) := 0;
  v_item_ref_basis numeric(14,2) := 0;
  v_remaining_refundable numeric(14,2) := 0;
  v_last_refunded_item_id uuid;
  v_rounding_adjustment numeric(14,2) := 0;$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund declaration patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$    SELECT id, branch_id, warehouse_id, status, total, paid_amount, customer_id, payment_method, invoice_number
      INTO v_sale FROM public.sales WHERE id = p_sale_id;$old$,
      $new$    SELECT id, branch_id, warehouse_id, status, subtotal, total, refunded_amount, paid_amount, customer_id, payment_method, invoice_number
      INTO v_sale FROM public.sales WHERE id = p_sale_id;$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund sale-header patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$    IF v_sale.status = 'returned' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RETURNED');
    END IF;$old$,
      $new$    IF v_sale.status = 'returned'
       AND (
         COALESCE(v_sale.refunded_amount, 0) > 0
         OR EXISTS (
           SELECT 1 FROM public.sale_items si
           WHERE si.sale_id = p_sale_id
             AND COALESCE(si.refunded_quantity, 0) > 0
         )
       ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RETURNED');
    END IF;$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund returned-state patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$    -- ===== REFUND + RESTOCK PHASE =====
    FOR v_item IN SELECT id, product_id, quantity, unit_price, discount_amount, refunded_quantity$old$,
      $new$    v_remaining_refundable := GREATEST(
      COALESCE(v_sale.total, 0) - COALESCE(v_sale.refunded_amount, 0),
      0
    );

    -- ===== REFUND + RESTOCK PHASE =====
    FOR v_item IN SELECT id, product_id, quantity, unit_price, discount_amount, refunded_quantity$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund remaining-amount patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$      v_item_line_total := v_item.quantity * v_item.unit_price - v_item.discount_amount;
      IF v_item.quantity > 0 THEN
        v_item_ref_amt := ROUND(v_item_line_total * v_req_qty / v_item.quantity, 2);
      ELSE
        v_item_ref_amt := 0;
      END IF;
      v_refund_total := v_refund_total + v_item_ref_amt;$old$,
      $new$      v_item_line_total := v_item.quantity * v_item.unit_price - v_item.discount_amount;
      IF v_item.quantity > 0 THEN
        v_item_ref_basis := ROUND(v_item_line_total * v_req_qty / v_item.quantity, 2);
      ELSE
        v_item_ref_basis := 0;
      END IF;

      v_refund_basis := v_refund_basis + v_item_ref_basis;

      -- Header-level discount/tax belongs proportionally to the selected line basis.
      -- The customer refund therefore follows the final authoritative sale total.
      IF COALESCE(v_sale.subtotal, 0) > 0 THEN
        v_item_ref_amt := ROUND(
          v_item_ref_basis * GREATEST(COALESCE(v_sale.total, 0), 0)
          / NULLIF(v_sale.subtotal, 0),
          2
        );
      ELSE
        v_item_ref_amt := 0;
      END IF;

      v_item_ref_amt := LEAST(
        GREATEST(v_item_ref_amt, 0),
        GREATEST(v_remaining_refundable - v_refund_total, 0)
      );
      v_refund_total := v_refund_total + v_item_ref_amt;
      v_last_refunded_item_id := v_item.id;$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund net-value patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$    SELECT bool_and(quantity = refunded_quantity) INTO v_all_refunded
      FROM sale_items WHERE sale_id = p_sale_id;
    UPDATE sales SET$old$,
      $new$    SELECT bool_and(quantity = refunded_quantity) INTO v_all_refunded
      FROM sale_items WHERE sale_id = p_sale_id;

    -- Make a full refund equal the exact remaining authoritative invoice total,
    -- absorbing only rounding cents into the final selected line.
    IF v_all_refunded AND v_last_refunded_item_id IS NOT NULL THEN
      v_rounding_adjustment := ROUND(v_remaining_refundable - v_refund_total, 2);
      IF v_rounding_adjustment <> 0 THEN
        UPDATE public.sale_items
        SET refunded_amount = GREATEST(COALESCE(refunded_amount, 0) + v_rounding_adjustment, 0)
        WHERE id = v_last_refunded_item_id;
      END IF;
      v_refund_total := v_remaining_refundable;
    END IF;

    UPDATE sales SET$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund rounding patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$    -- ===== LEDGER POSTING: prorated reversal of the original sale =====
    IF v_refund_total > 0 THEN$old$,
      $new$    -- ===== LEDGER POSTING: prorated reversal of the original sale =====
    -- A 100%-discount sale has zero cash refund but still needs revenue/discount/COGS reversal.
    IF v_refund_basis > 0 THEN$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund journal-gate patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$        v_ratio := round(v_refund_total / GREATEST(COALESCE(v_sale.total, 0), 1), 6);$old$,
      $new$        v_ratio := LEAST(
          1,
          GREATEST(
            0,
            round(v_refund_basis / GREATEST(COALESCE(v_sale.subtotal, 0), 1), 6)
          )
        );$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund journal-ratio patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
      'refunded_amount', v_refund_total, 'fully_refunded', v_all_refunded);$old$,
      $new$    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
      'refunded_amount', v_refund_total, 'refund_basis', v_refund_basis,
      'fully_refunded', v_all_refunded);$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'refund result patch point not found'; END IF;

    EXECUTE v_def;
  END IF;
END;
$patch_refund$;

DO $patch_day_report$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef('public._build_day_closing_report(uuid,date)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN RAISE EXCEPTION '_build_day_closing_report target not found'; END IF;

  IF position('original_discount_amount' in v_def) = 0 THEN
    v_before := v_def;
    v_def := replace(
      v_def,
      $old$    'subtotal',s.subtotal,'discount_amount',s.discount_amount,'tax_amount',s.tax_amount,'total',s.total,$old$,
      $new$    'subtotal',round(s.subtotal*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status),2),
    'discount_amount',round(s.discount_amount*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status),2),
    'tax_amount',round(s.tax_amount*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status),2),
    'original_subtotal',s.subtotal,'original_discount_amount',s.discount_amount,'original_tax_amount',s.tax_amount,'total',s.total,$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'day report sale detail patch point not found'; END IF;
    EXECUTE v_def;
  END IF;
END;
$patch_day_report$;

DO $patch_shift_report$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef('public.get_shift_closing_report(uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_shift_closing_report target not found'; END IF;

  IF position('private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status)' in v_def) = 0 THEN
    v_before := v_def;
    v_def := replace(
      v_def,
      $old$  SELECT COALESCE(sum(s.subtotal),0),COALESCE(sum(s.discount_amount),0),COALESCE(sum(s.tax_amount),0),
         COALESCE(sum(s.refunded_amount),0),COALESCE(sum(s.total-COALESCE(s.refunded_amount,0)),0),count(*)::int$old$,
      $new$  SELECT
         COALESCE(sum(s.subtotal*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status)),0),
         COALESCE(sum(s.discount_amount*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status)),0),
         COALESCE(sum(s.tax_amount*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status)),0),
         COALESCE(sum(s.refunded_amount),0),
         COALESCE(sum(GREATEST(s.total-COALESCE(s.refunded_amount,0),0)),0),
         count(*)::int$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'shift aggregate patch point not found'; END IF;

    v_before := v_def;
    v_def := replace(
      v_def,
      $old$    'user_name',COALESCE(u.full_name,u.email,'-'),'subtotal',s.subtotal,'discount_amount',s.discount_amount,
    'tax_amount',s.tax_amount,'total',s.total,'paid_amount',s.paid_amount,'refunded_amount',COALESCE(s.refunded_amount,0),$old$,
      $new$    'user_name',COALESCE(u.full_name,u.email,'-'),
    'subtotal',round(s.subtotal*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status),2),
    'discount_amount',round(s.discount_amount*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status),2),
    'tax_amount',round(s.tax_amount*private.sale_report_remaining_ratio(s.total,s.refunded_amount,s.status),2),
    'original_subtotal',s.subtotal,'original_discount_amount',s.discount_amount,'original_tax_amount',s.tax_amount,
    'total',s.total,'paid_amount',s.paid_amount,'refunded_amount',COALESCE(s.refunded_amount,0),$new$
    );
    IF v_def = v_before THEN RAISE EXCEPTION 'shift detail patch point not found'; END IF;

    EXECUTE v_def;
  END IF;
END;
$patch_shift_report$;

COMMIT;
