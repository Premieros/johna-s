-- Online price helpers are internal to SECURITY DEFINER trusted POS writers.
-- Public authenticated RPC invocation is unnecessary and could reveal a
-- different branch's configured markup with arbitrary base-price probes.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
REVOKE ALL ON FUNCTION public._online_order_price(uuid,text,numeric)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._online_order_price(uuid,text,numeric,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._online_order_price(uuid,text,numeric)
  TO postgres,service_role;
GRANT EXECUTE ON FUNCTION public._online_order_price(uuid,text,numeric,uuid)
  TO postgres,service_role;
COMMIT;
