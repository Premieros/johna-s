-- Employee receivables are customer accounts classified independently from auth/system users.
-- Keep employee_user_id temporarily for backwards compatibility with historical rows; new logic does not depend on it.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'customer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_customer_type_check'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_customer_type_check
      CHECK (customer_type IN ('customer', 'employee'));
  END IF;
END $$;

-- Preserve accounts that were historically linked as employee credit accounts.
UPDATE public.customers
SET customer_type = 'employee'
WHERE employee_user_id IS NOT NULL
  AND customer_type = 'customer';

CREATE INDEX IF NOT EXISTS idx_customers_branch_customer_type
  ON public.customers (branch_id, customer_type);

COMMENT ON COLUMN public.customers.customer_type IS
  'Business classification for customer accounts. employee is independent from system/auth users.';
