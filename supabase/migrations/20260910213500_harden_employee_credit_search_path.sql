-- Match the repository's authenticated SECURITY DEFINER hardening contract.
-- No data changes; only function configuration is updated.

ALTER FUNCTION public.link_employee_credit_account(uuid, uuid, uuid)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.receive_employee_credit_payment(uuid, uuid, numeric, text, uuid, text)
  SET search_path TO public, pg_temp;
