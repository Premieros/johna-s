-- Employee-only POS credit enforcement.
-- Credit/deferred sales are no longer a generic customer payment method.
-- Historical rows are preserved; this guard applies to future inserts and
-- changes that attempt to make a sale credit or change its customer/branch.

CREATE OR REPLACE FUNCTION public.enforce_employee_only_credit_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $$
BEGIN
  IF lower(COALESCE(NEW.payment_method, '')) = 'credit' THEN
    IF NEW.customer_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.customers c
         WHERE c.id = NEW.customer_id
           AND c.branch_id = NEW.branch_id
           AND c.customer_type = 'employee'
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'CREDIT_EMPLOYEE_ONLY',
        DETAIL = 'Credit payment is allowed only for a customer classified as employee in the same branch.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_employee_only_credit_sale()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sales_employee_only_credit ON public.sales;
CREATE TRIGGER trg_sales_employee_only_credit
BEFORE INSERT OR UPDATE OF payment_method, customer_id, branch_id
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.enforce_employee_only_credit_sale();

COMMENT ON FUNCTION public.enforce_employee_only_credit_sale() IS
  'Rejects credit/deferred sales unless the selected customer is classified as employee in the same branch.';
