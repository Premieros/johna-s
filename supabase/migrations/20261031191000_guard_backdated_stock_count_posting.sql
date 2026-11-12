-- Fail-closed server boundary for the staged physical cutoff.
-- This migration does not permit backdated application or alter legacy sessions.
CREATE OR REPLACE FUNCTION public.guard_stock_count_cutoff_pre_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A historical count must have a real physical timestamp, never a future one.
  IF NEW.counted_at IS NOT NULL AND NEW.counted_at > statement_timestamp() THEN
    RAISE EXCEPTION 'STOCK_COUNT_FUTURE_CUTOFF';
  END IF;

  -- Once counting is submitted, its physical cutoff is immutable.
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft'
     AND NEW.counted_at IS DISTINCT FROM OLD.counted_at THEN
    RAISE EXCEPTION 'STOCK_COUNT_CUTOFF_LOCKED';
  END IF;

  -- No backdated/dated count can be posted by the legacy live-balance writer.
  -- This guard remains until an independently verified historical FIFO writer
  -- replaces the legacy behavior in an explicit release.
  IF NEW.counted_at IS NOT NULL AND NEW.status = 'applied' THEN
    RAISE EXCEPTION 'STOCK_COUNT_HISTORICAL_APPLY_NOT_READY';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_stock_count_cutoff_pre_reconciliation
  ON public.stock_counts;
CREATE TRIGGER trg_guard_stock_count_cutoff_pre_reconciliation
BEFORE INSERT OR UPDATE ON public.stock_counts
FOR EACH ROW
EXECUTE FUNCTION public.guard_stock_count_cutoff_pre_reconciliation();
