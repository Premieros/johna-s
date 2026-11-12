-- Existing raw adapters are INVOKER and are already executable by the trusted
-- service backend. Preserve that server contract without granting any helper
-- or activation-table access to authenticated/anon clients.
GRANT SELECT ON private.raw_cost_v2_activated_coordinates TO service_role;
GRANT EXECUTE ON FUNCTION private.raw_last_price_enabled(uuid,uuid,uuid),
 private.stock_count_raw_price(uuid,uuid[],timestamptz),
 private.validate_count_legacy_quantity(uuid,uuid,uuid),
 private.offset_stock_count_legacy_quantity(bigint,uuid),
 private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb),
 private.raw_receive_approved_v2(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb),
 private.raw_receive_approved_v2_lot(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,text,date,date)
 TO service_role;
-- Owner-only activation functions and all mutation rights on the routing table
-- stay revoked from service_role; no new PUBLIC or browser API is introduced.
