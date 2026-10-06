-- CI-only, bounded catalog checks. Never invoke an operational RPC or read its data.
-- Invoker rights and existing RLS/ACLs remain unchanged. Invalid input fails closed.
CREATE FUNCTION public._production_api_contract_v1(p_contract jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  item jsonb;
  arg jsonb;
  expected text[];
  matches integer;
  rpc_results jsonb := '[]'::jsonb;
  table_results jsonb := '[]'::jsonb;
  seen text[] := ARRAY[]::text[];
  object_name text;
BEGIN
  IF p_contract IS NULL OR octet_length(p_contract::text) > 100000
     OR jsonb_typeof(p_contract) <> 'object'
     OR jsonb_typeof(p_contract->'rpcs') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_contract->'tables') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('version', 1, 'valid', false);
  END IF;
  IF jsonb_array_length(p_contract->'rpcs') NOT BETWEEN 1 AND 500
     OR jsonb_array_length(p_contract->'tables') NOT BETWEEN 1 AND 200 THEN
    RETURN jsonb_build_object('version', 1, 'valid', false);
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_contract->'rpcs') LOOP
    object_name := item->>'name';
    IF jsonb_typeof(item) <> 'object' OR object_name IS NULL
       OR object_name !~ '^[a-z_][a-z0-9_]{0,62}$' OR object_name = ANY(seen)
       OR jsonb_typeof(item->'params') IS DISTINCT FROM 'array' THEN
      RETURN jsonb_build_object('version', 1, 'valid', false);
    END IF;
    seen := array_append(seen, object_name);
    IF jsonb_array_length(item->'params') > 100 THEN
      RETURN jsonb_build_object('version', 1, 'valid', false);
    END IF;
    expected := ARRAY[]::text[];
    FOR arg IN SELECT value FROM jsonb_array_elements(item->'params') LOOP
      IF jsonb_typeof(arg) <> 'string' OR (arg #>> '{}') !~ '^[a-z_][a-z0-9_]{0,60}$'
         OR ('p_' || (arg #>> '{}')) = ANY(expected) THEN
        RETURN jsonb_build_object('version', 1, 'valid', false);
      END IF;
      expected := array_append(expected, 'p_' || (arg #>> '{}'));
    END LOOP;
    SELECT count(*) INTO matches
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL (
      SELECT coalesce(array_agg(a.name ORDER BY a.ord), ARRAY[]::text[]) AS names
      FROM unnest(p.proargnames) WITH ORDINALITY a(name, ord)
      WHERE coalesce(p.proargmodes[a.ord], 'i'::"char") IN ('i', 'b')
    ) inputs
    WHERE n.nspname = 'public' AND p.proname = object_name
      AND p.prokind = 'f' AND p.provariadic = 0
      AND cardinality(inputs.names) = p.pronargs
      AND expected <@ inputs.names
      AND inputs.names[1:(p.pronargs - p.pronargdefaults)] <@ expected;
    rpc_results := rpc_results || jsonb_build_array(jsonb_build_object(
      'name', object_name, 'present', matches = 1));
  END LOOP;
  seen := ARRAY[]::text[];
  FOR item IN SELECT value FROM jsonb_array_elements(p_contract->'tables') LOOP
    object_name := item #>> '{}';
    IF jsonb_typeof(item) <> 'string' OR object_name !~ '^[a-z_][a-z0-9_]{0,62}$'
       OR object_name = ANY(seen) THEN
      RETURN jsonb_build_object('version', 1, 'valid', false);
    END IF;
    seen := array_append(seen, object_name);
    table_results := table_results || jsonb_build_array(jsonb_build_object(
      'name', object_name, 'present', EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = object_name
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      )));
  END LOOP;
  RETURN jsonb_build_object('version', 1, 'valid', true,
    'rpcs', rpc_results, 'tables', table_results);
END;
$$;
REVOKE ALL ON FUNCTION public._production_api_contract_v1(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._production_api_contract_v1(jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public._production_api_contract_v1(jsonb) IS
  'Bounded CI catalog parity check: no operational data or RPC execution; fails closed on malformed or ambiguous contracts.';
-- Make the new metadata endpoint available through PostgREST after commit.
NOTIFY pgrst, 'reload schema';
