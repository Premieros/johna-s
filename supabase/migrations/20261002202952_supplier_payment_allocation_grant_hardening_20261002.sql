BEGIN;

-- Production projects may inherit permissive default table grants for new public tables.
-- The allocation ledger is append-only and must be mutated only by internal trigger paths.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.supplier_payment_allocations
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE public.supplier_payment_allocations
TO authenticated, service_role;

COMMIT;
