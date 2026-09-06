-- P0-B root-cause hardening: subscription/payment runtime RPC search_path only.
-- Intentionally does not rewrite function bodies, authorization logic, grants, or API contracts.

BEGIN;

ALTER FUNCTION public.submit_instapay_payment(uuid, text, numeric, text, text, text)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.review_instapay_payment(uuid, boolean, text)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.subscription_expired(uuid)
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.subscription_settings_get()
  SET search_path TO public, pg_temp;

ALTER FUNCTION public.super_admin_remove_branch_override(uuid, text)
  SET search_path TO public, pg_temp;

COMMIT;
