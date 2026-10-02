BEGIN;

-- ERP-style supplier payment subledger.
-- Existing supplier_payment rows remain legacy audit history. New payments are managed
-- and every amount applied to a purchase/opening balance is recorded as an immutable event.

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS allocation_mode text;

UPDATE public.supplier_payments
SET allocation_mode = 'legacy'
WHERE allocation_mode IS NULL;

ALTER TABLE public.supplier_payments
  ALTER COLUMN allocation_mode SET DEFAULT 'managed',
  ALTER COLUMN allocation_mode SET NOT NULL;

ALTER TABLE public.supplier_payments
  DROP CONSTRAINT IF EXISTS supplier_payments_allocation_mode_check;

ALTER TABLE public.supplier_payments
  ADD CONSTRAINT supplier_payments_allocation_mode_check
  CHECK (allocation_mode IN ('legacy','managed'));

CREATE TABLE IF NOT EXISTS public.supplier_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id uuid NOT NULL
    REFERENCES public.supplier_payments(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL
    REFERENCES public.branches(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL
    REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  target_type text NOT NULL
    CHECK (target_type IN ('purchase','opening_balance')),
  purchase_id uuid
    REFERENCES public.purchases(id) ON DELETE SET NULL,
  opening_balance_id uuid
    REFERENCES public.supplier_opening_balances(id) ON DELETE SET NULL,
  target_reference text NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('apply','unapply')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reverses_allocation_id uuid
    REFERENCES public.supplier_payment_allocations(id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_payment_allocations_target_shape CHECK (
    (target_type='purchase' AND opening_balance_id IS NULL)
    OR
    (target_type='opening_balance' AND purchase_id IS NULL)
  ),
  CONSTRAINT supplier_payment_allocations_reversal_shape CHECK (
    (event_type='apply' AND reverses_allocation_id IS NULL)
    OR
    (event_type='unapply' AND reverses_allocation_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.supplier_payment_allocations IS
  'Append-only supplier payment allocation events. Payment is the cash/bank truth; allocations map managed payments to purchases/opening balances. Unapply events release credit without rewriting payment history.';

CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_payment
  ON public.supplier_payment_allocations(supplier_payment_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_purchase
  ON public.supplier_payment_allocations(purchase_id, created_at, id)
  WHERE purchase_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_opening
  ON public.supplier_payment_allocations(opening_balance_id, created_at, id)
  WHERE opening_balance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_supplier_branch
  ON public.supplier_payment_allocations(branch_id, supplier_id, created_at);

ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_payment_allocations_select
  ON public.supplier_payment_allocations;

CREATE POLICY supplier_payment_allocations_select
ON public.supplier_payment_allocations
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND public.can_permission('suppliers.view')
);

-- Allocation rows are append-only. The only allowed UPDATE is the FK cleanup that
-- nulls a deleted purchase/opening-balance reference while retaining target_reference.
CREATE OR REPLACE FUNCTION public._guard_supplier_payment_allocation_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_IMMUTABLE';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id = OLD.id
       AND NEW.supplier_payment_id = OLD.supplier_payment_id
       AND NEW.branch_id = OLD.branch_id
       AND NEW.supplier_id = OLD.supplier_id
       AND NEW.target_type = OLD.target_type
       AND NEW.target_reference = OLD.target_reference
       AND NEW.event_type = OLD.event_type
       AND NEW.amount = OLD.amount
       AND NEW.reverses_allocation_id IS NOT DISTINCT FROM OLD.reverses_allocation_id
       AND NEW.reason_code = OLD.reason_code
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
       AND NEW.created_at = OLD.created_at
       AND (
         (
           OLD.target_type='purchase'
           AND OLD.purchase_id IS NOT NULL
           AND NEW.purchase_id IS NULL
           AND NEW.opening_balance_id IS NOT DISTINCT FROM OLD.opening_balance_id
         )
         OR
         (
           OLD.target_type='opening_balance'
           AND OLD.opening_balance_id IS NOT NULL
           AND NEW.opening_balance_id IS NULL
           AND NEW.purchase_id IS NOT DISTINCT FROM OLD.purchase_id
         )
       )
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_supplier_payment_allocation_immutable
  ON public.supplier_payment_allocations;

CREATE TRIGGER trg_supplier_payment_allocation_immutable
BEFORE UPDATE OR DELETE ON public.supplier_payment_allocations
FOR EACH ROW
EXECUTE FUNCTION public._guard_supplier_payment_allocation_immutable();

-- Put the managed payment id in transaction-local context. The existing
-- pay_supplier_from_treasury RPC inserts the payment before it updates the target
-- purchase/opening balance, so this captures the exact payment without guessing
-- by timestamp and remains concurrency-safe.
CREATE OR REPLACE FUNCTION public._set_supplier_payment_allocation_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  IF NEW.allocation_mode = 'managed' THEN
    PERFORM set_config('app.current_supplier_payment_id', NEW.id::text, true);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_supplier_payment_allocation_context
  ON public.supplier_payments;

CREATE TRIGGER trg_supplier_payment_allocation_context
AFTER INSERT ON public.supplier_payments
FOR EACH ROW
EXECUTE FUNCTION public._set_supplier_payment_allocation_context();

CREATE OR REPLACE FUNCTION public._supplier_payment_net_allocated(p_payment_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT round(COALESCE(SUM(
    CASE WHEN a.event_type='apply' THEN a.amount ELSE -a.amount END
  ),0),2)
  FROM public.supplier_payment_allocations a
  WHERE a.supplier_payment_id = p_payment_id;
$function$;

CREATE OR REPLACE FUNCTION public._supplier_purchase_net_allocated(p_purchase_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT round(COALESCE(SUM(
    CASE WHEN a.event_type='apply' THEN a.amount ELSE -a.amount END
  ),0),2)
  FROM public.supplier_payment_allocations a
  WHERE a.purchase_id = p_purchase_id
    AND a.target_type='purchase';
$function$;

CREATE OR REPLACE FUNCTION public._record_supplier_payment_apply(
  p_payment_id uuid,
  p_target_type text,
  p_purchase_id uuid,
  p_opening_balance_id uuid,
  p_target_reference text,
  p_amount numeric,
  p_reason_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_payment public.supplier_payments%ROWTYPE;
  v_purchase public.purchases%ROWTYPE;
  v_opening public.supplier_opening_balances%ROWTYPE;
  v_remaining numeric(14,2);
  v_id uuid;
BEGIN
  IF p_amount IS NULL OR round(p_amount,2) <= 0 THEN
    RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.supplier_payments
  WHERE id=p_payment_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.allocation_mode <> 'managed' THEN
    RAISE EXCEPTION 'MANAGED_SUPPLIER_PAYMENT_REQUIRED';
  END IF;

  v_remaining := round(
    v_payment.amount - public._supplier_payment_net_allocated(v_payment.id),
    2
  );

  IF round(p_amount,2) > v_remaining THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_EXCEEDS_UNAPPLIED';
  END IF;

  IF p_target_type='purchase' THEN
    IF p_purchase_id IS NULL OR p_opening_balance_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_PURCHASE_ALLOCATION_TARGET';
    END IF;

    SELECT *
    INTO v_purchase
    FROM public.purchases
    WHERE id=p_purchase_id;

    IF NOT FOUND
       OR v_purchase.supplier_id IS DISTINCT FROM v_payment.supplier_id
       OR v_purchase.branch_id IS DISTINCT FROM v_payment.branch_id THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_TARGET_MISMATCH';
    END IF;
  ELSIF p_target_type='opening_balance' THEN
    IF p_opening_balance_id IS NULL OR p_purchase_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_OPENING_ALLOCATION_TARGET';
    END IF;

    SELECT *
    INTO v_opening
    FROM public.supplier_opening_balances
    WHERE id=p_opening_balance_id;

    IF NOT FOUND
       OR v_opening.supplier_id IS DISTINCT FROM v_payment.supplier_id
       OR v_opening.branch_id IS DISTINCT FROM v_payment.branch_id THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_TARGET_MISMATCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_ALLOCATION_TARGET_TYPE';
  END IF;

  INSERT INTO public.supplier_payment_allocations (
    supplier_payment_id,
    branch_id,
    supplier_id,
    target_type,
    purchase_id,
    opening_balance_id,
    target_reference,
    event_type,
    amount,
    reverses_allocation_id,
    reason_code,
    created_by
  )
  VALUES (
    v_payment.id,
    v_payment.branch_id,
    v_payment.supplier_id,
    p_target_type,
    p_purchase_id,
    p_opening_balance_id,
    p_target_reference,
    'apply',
    round(p_amount,2),
    NULL,
    COALESCE(NULLIF(btrim(p_reason_code),''),'payment_apply'),
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._capture_supplier_purchase_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_payment_text text;
  v_payment_id uuid;
  v_delta numeric(14,2);
  v_internal text;
BEGIN
  v_delta := round(COALESCE(NEW.paid_amount,0)-COALESCE(OLD.paid_amount,0),2);
  IF v_delta <= 0 THEN
    RETURN NEW;
  END IF;

  v_internal := current_setting('app.supplier_allocation_internal', true);
  IF COALESCE(v_internal,'') = '1' THEN
    RETURN NEW;
  END IF;

  v_payment_text := current_setting('app.current_supplier_payment_id', true);
  IF v_payment_text IS NULL OR btrim(v_payment_text)='' THEN
    -- Legacy/manual paid_amount writes stay legacy. New payment RPC writes are
    -- managed because their supplier_payment insert sets the transaction context.
    RETURN NEW;
  END IF;

  v_payment_id := v_payment_text::uuid;

  PERFORM public._record_supplier_payment_apply(
    v_payment_id,
    'purchase',
    NEW.id,
    NULL,
    NEW.invoice_number,
    v_delta,
    'payment_apply'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_supplier_purchase_payment_allocation
  ON public.purchases;

CREATE TRIGGER trg_capture_supplier_purchase_payment_allocation
AFTER UPDATE OF paid_amount ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public._capture_supplier_purchase_payment_allocation();

CREATE OR REPLACE FUNCTION public._capture_supplier_opening_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_payment_text text;
  v_payment_id uuid;
  v_delta numeric(14,2);
BEGIN
  v_delta := round(COALESCE(NEW.settled_amount,0)-COALESCE(OLD.settled_amount,0),2);
  IF v_delta <= 0 THEN
    RETURN NEW;
  END IF;

  v_payment_text := current_setting('app.current_supplier_payment_id', true);
  IF v_payment_text IS NULL OR btrim(v_payment_text)='' THEN
    RETURN NEW;
  END IF;

  v_payment_id := v_payment_text::uuid;

  PERFORM public._record_supplier_payment_apply(
    v_payment_id,
    'opening_balance',
    NULL,
    NEW.id,
    'SUP-OPEN-' || left(NEW.id::text,8),
    v_delta,
    'opening_balance_payment_apply'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_supplier_opening_payment_allocation
  ON public.supplier_opening_balances;

CREATE TRIGGER trg_capture_supplier_opening_payment_allocation
AFTER UPDATE OF settled_amount ON public.supplier_opening_balances
FOR EACH ROW
EXECUTE FUNCTION public._capture_supplier_opening_payment_allocation();

CREATE OR REPLACE FUNCTION public._supplier_unapply_purchase_amount(
  p_purchase_id uuid,
  p_amount numeric,
  p_reason_code text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_remaining numeric(14,2) := round(COALESCE(p_amount,0),2);
  v_release numeric(14,2);
  v_released numeric(14,2) := 0;
  v_apply record;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_apply IN
    SELECT
      a.id,
      a.supplier_payment_id,
      a.branch_id,
      a.supplier_id,
      a.purchase_id,
      a.target_reference,
      round(
        a.amount - COALESCE((
          SELECT SUM(u.amount)
          FROM public.supplier_payment_allocations u
          WHERE u.event_type='unapply'
            AND u.reverses_allocation_id=a.id
        ),0),
        2
      ) AS available
    FROM public.supplier_payment_allocations a
    WHERE a.event_type='apply'
      AND a.target_type='purchase'
      AND a.purchase_id=p_purchase_id
    ORDER BY a.created_at DESC, a.id DESC
  LOOP
    EXIT WHEN v_remaining <= 0;

    IF v_apply.available <= 0 THEN
      CONTINUE;
    END IF;

    v_release := LEAST(v_remaining, v_apply.available);

    INSERT INTO public.supplier_payment_allocations (
      supplier_payment_id,
      branch_id,
      supplier_id,
      target_type,
      purchase_id,
      opening_balance_id,
      target_reference,
      event_type,
      amount,
      reverses_allocation_id,
      reason_code,
      created_by
    )
    VALUES (
      v_apply.supplier_payment_id,
      v_apply.branch_id,
      v_apply.supplier_id,
      'purchase',
      p_purchase_id,
      NULL,
      v_apply.target_reference,
      'unapply',
      round(v_release,2),
      v_apply.id,
      COALESCE(NULLIF(btrim(p_reason_code),''),'purchase_release'),
      auth.uid()
    );

    v_remaining := round(v_remaining-v_release,2);
    v_released := round(v_released+v_release,2);
  END LOOP;

  RETURN v_released;
END;
$function$;

-- If a return/correction lowers the invoice net below its paid mirror, release the
-- managed allocation first. If the excess is legacy/untraceable, fail closed
-- rather than silently losing payment history.
CREATE OR REPLACE FUNCTION public._supplier_release_excess_before_purchase_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_net numeric(14,2);
  v_excess numeric(14,2);
  v_managed numeric(14,2);
  v_released numeric(14,2);
BEGIN
  IF COALESCE(NEW.payment_method,'') <> 'credit'
     OR COALESCE(NEW.paid_amount,0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_net := round(GREATEST(
    COALESCE(NEW.total,0)-COALESCE(NEW.returned_amount,0),
    0
  ),2);

  v_excess := round(COALESCE(NEW.paid_amount,0)-v_net,2);
  IF v_excess <= 0 THEN
    RETURN NEW;
  END IF;

  v_managed := public._supplier_purchase_net_allocated(OLD.id);

  IF v_managed + 0.009 < v_excess THEN
    RAISE EXCEPTION 'LEGACY_PAID_PURCHASE_REQUIRES_RECONCILIATION';
  END IF;

  v_released := public._supplier_unapply_purchase_amount(
    OLD.id,
    v_excess,
    CASE
      WHEN COALESCE(NEW.returned_amount,0) > COALESCE(OLD.returned_amount,0)
        THEN 'purchase_return_release'
      ELSE 'purchase_correction_release'
    END
  );

  IF abs(v_released-v_excess) > 0.009 THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_RELEASE_MISMATCH';
  END IF;

  NEW.paid_amount := round(COALESCE(NEW.paid_amount,0)-v_released,2);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_supplier_release_excess_before_purchase_change
  ON public.purchases;

CREATE TRIGGER trg_supplier_release_excess_before_purchase_change
BEFORE UPDATE OF total, returned_amount, status ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public._supplier_release_excess_before_purchase_change();

-- Reuse released managed credit on the next completed credit invoice. This is
-- subledger-only: cash/bank and the original supplier-payment journal stay untouched.
CREATE OR REPLACE FUNCTION public._supplier_auto_apply_unapplied_credit(
  p_purchase_id uuid,
  p_reason_code text DEFAULT 'auto_unapplied_credit'
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_purchase public.purchases%ROWTYPE;
  v_remaining numeric(14,2);
  v_payment record;
  v_apply numeric(14,2);
  v_applied numeric(14,2) := 0;
BEGIN
  SELECT *
  INTO v_purchase
  FROM public.purchases
  WHERE id=p_purchase_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_purchase.status <> 'completed'
     OR v_purchase.payment_method <> 'credit'
     OR v_purchase.supplier_id IS NULL THEN
    RETURN 0;
  END IF;

  v_remaining := round(GREATEST(
    v_purchase.total
    - COALESCE(v_purchase.returned_amount,0)
    - COALESCE(v_purchase.paid_amount,0),
    0
  ),2);

  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_payment IN
    SELECT
      sp.id,
      round(
        sp.amount - public._supplier_payment_net_allocated(sp.id),
        2
      ) AS available
    FROM public.supplier_payments sp
    WHERE sp.supplier_id=v_purchase.supplier_id
      AND sp.branch_id=v_purchase.branch_id
      AND sp.allocation_mode='managed'
      AND round(
        sp.amount-public._supplier_payment_net_allocated(sp.id),
        2
      ) > 0
    ORDER BY sp.created_at ASC, sp.id ASC
    FOR UPDATE OF sp
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_apply := LEAST(v_remaining, v_payment.available);
    IF v_apply <= 0 THEN
      CONTINUE;
    END IF;

    PERFORM public._record_supplier_payment_apply(
      v_payment.id,
      'purchase',
      v_purchase.id,
      NULL,
      v_purchase.invoice_number,
      v_apply,
      p_reason_code
    );

    PERFORM set_config('app.supplier_allocation_internal','1',true);
    UPDATE public.purchases
    SET paid_amount=round(COALESCE(paid_amount,0)+v_apply,2)
    WHERE id=v_purchase.id;
    PERFORM set_config('app.supplier_allocation_internal','0',true);

    v_remaining := round(v_remaining-v_apply,2);
    v_applied := round(v_applied+v_apply,2);
  END LOOP;

  RETURN v_applied;
END;
$function$;

CREATE OR REPLACE FUNCTION public._supplier_auto_apply_unapplied_credit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  IF NEW.status='completed'
     AND NEW.payment_method='credit'
     AND NEW.supplier_id IS NOT NULL THEN
    PERFORM public._supplier_auto_apply_unapplied_credit(
      NEW.id,
      'auto_credit_to_new_invoice'
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_supplier_auto_apply_unapplied_credit
  ON public.purchases;

CREATE TRIGGER trg_supplier_auto_apply_unapplied_credit
AFTER INSERT ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public._supplier_auto_apply_unapplied_credit_trigger();

-- Internal helpers are trigger/RPC implementation details, not public API endpoints.
REVOKE ALL ON FUNCTION public._guard_supplier_payment_allocation_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._set_supplier_payment_allocation_context() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._supplier_payment_net_allocated(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._supplier_purchase_net_allocated(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._record_supplier_payment_apply(uuid,text,uuid,uuid,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._capture_supplier_purchase_payment_allocation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._capture_supplier_opening_payment_allocation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._supplier_unapply_purchase_amount(uuid,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._supplier_release_excess_before_purchase_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._supplier_auto_apply_unapplied_credit(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._supplier_auto_apply_unapplied_credit_trigger() FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.supplier_payment_allocations TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
