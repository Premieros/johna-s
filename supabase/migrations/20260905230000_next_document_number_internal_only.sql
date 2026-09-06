-- P0-B final handover hardening.
-- next_document_number is an internal sequence helper used by privileged RPCs.
-- It must not be exposed as a directly callable authenticated/anonymous endpoint.

ALTER FUNCTION public.next_document_number(text)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.next_document_number(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_document_number(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_document_number(text) FROM authenticated;

-- Keep explicit backend/service access. The function owner retains its implicit
-- ability to call the helper from SECURITY DEFINER application RPCs.
GRANT EXECUTE ON FUNCTION public.next_document_number(text) TO service_role;
