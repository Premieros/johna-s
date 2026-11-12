-- Isolated prototype: plan a stock-count quantity correction without FIFO valuation.
-- This function writes nothing and does not authorize production posting.
CREATE OR REPLACE FUNCTION private.plan_stock_count_quantity(
  p_counted numeric, p_balance_at_count numeric, p_balance_now numeric,
  p_later_movement numeric, p_negative_lot_qty numeric, p_open_debt_qty numeric,
  p_latest_price numeric
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  delta numeric;
  absorb numeric;
BEGIN
  IF p_counted IS NULL OR p_balance_at_count IS NULL OR p_balance_now IS NULL
     OR p_later_movement IS NULL OR p_negative_lot_qty IS NULL OR p_open_debt_qty IS NULL
     OR p_latest_price IS NULL OR p_counted<0 OR p_negative_lot_qty<0 OR p_open_debt_qty<0
     OR p_latest_price<0 THEN
    RAISE EXCEPTION 'STOCK_COUNT_PLAN_INVALID_INPUT';
  END IF;
  IF p_balance_now IS DISTINCT FROM p_balance_at_count+p_later_movement
     OR p_negative_lot_qty IS DISTINCT FROM p_open_debt_qty THEN
    RAISE EXCEPTION 'STOCK_COUNT_PLAN_UNRECONCILED';
  END IF;
  delta:=p_counted-p_balance_at_count;
  absorb:=least(greatest(delta,0),p_negative_lot_qty);
  RETURN jsonb_build_object(
    'delta',delta,'balance_after',p_balance_now+delta,
    'negative_quantity_to_offset',absorb,'negative_quantity_remaining',p_negative_lot_qty-absorb,
    'positive_receipt_remaining',greatest(delta,0)-absorb,
    'latest_price',p_latest_price,'adjustment_value',round(delta*p_latest_price,2)
  );
END;
$$;
REVOKE ALL ON FUNCTION private.plan_stock_count_quantity(numeric,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
