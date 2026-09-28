-- Stability Foundation Phase 1
-- Internal trigger functions are implementation details, not client-callable RPCs.
-- Revoking client EXECUTE does not change trigger attachment or trigger execution.

REVOKE ALL ON FUNCTION public._raw_inventory_actual_avg_cost_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._raw_inventory_actual_avg_cost_guard() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_inventory_actual_avg_cost_guard() TO service_role;

REVOKE ALL ON FUNCTION public._raw_price_oversold_batch_from_fifo() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._raw_price_oversold_batch_from_fifo() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_price_oversold_batch_from_fifo() TO service_role;

REVOKE ALL ON FUNCTION public.treasury_accounts_fill_model_defaults() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.treasury_accounts_fill_model_defaults() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treasury_accounts_fill_model_defaults() TO service_role;

NOTIFY pgrst, 'reload schema';
