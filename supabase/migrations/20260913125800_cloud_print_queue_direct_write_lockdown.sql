-- Lock the cloud print queue to RPC-only mutations.
-- Authenticated users may inspect only the rows allowed by RLS. Enqueue/claim/start/
-- complete operations must go through the hardened SECURITY DEFINER RPCs.

ALTER TABLE public.cloud_print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_print_jobs FORCE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.cloud_print_jobs
  FROM authenticated;

GRANT SELECT ON TABLE public.cloud_print_jobs TO authenticated;

-- Keep anonymous/public callers fully denied at the table boundary.
REVOKE ALL ON TABLE public.cloud_print_jobs FROM PUBLIC, anon;
