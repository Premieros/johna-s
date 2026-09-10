ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_print_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_print_status_check
  CHECK (
    print_status = ANY (
      ARRAY[
        'pending'::text,
        'printed'::text,
        'cancelled'::text,
        'failed'::text
      ]
    )
  );
