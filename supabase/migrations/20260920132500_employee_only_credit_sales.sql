-- Employee-only POS credit enforcement.
-- Credit/deferred sales are no longer a generic customer payment method.
-- Historical rows are preserved; this guard applies to future inserts and
-- changes that attempt to make a sale credit or change its customer/branch.

-- Keep the legacy employee-link action aligned with the canonical
-- customers.customer_type classification. New authorization logic still
-- depends on customer_type, not role names or auth-user linkage.
CREATE OR REPLACE FUNCTION public.link_employee_credit_account(
  p_customer_id uuid,
  p_employee_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $link_employee$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('customers.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'customers.manage');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = p_customer_id AND c.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'CUSTOMER_NOT_FOUND');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_employee_id
      AND u.is_active = true
      AND (u.branch_id = p_branch_id OR u.branch_id IS NULL)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_NOT_FOUND_IN_BRANCH');
  END IF;

  UPDATE public.customers
  SET employee_user_id = p_employee_id,
      customer_type = 'employee'
  WHERE id = p_customer_id
    AND branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'employee_id', p_employee_id,
    'customer_type', 'employee'
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_ALREADY_LINKED');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$link_employee$;

CREATE OR REPLACE FUNCTION public.enforce_employee_only_credit_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $employee_credit_guard$
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
$employee_credit_guard$;

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
