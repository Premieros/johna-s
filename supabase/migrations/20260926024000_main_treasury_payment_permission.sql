-- Main Treasury supplier-payment permission clarity.
-- No balances, payments, reports, or historical rows are rewritten.

DROP POLICY IF EXISTS auth_select_organization_treasury_accounts
  ON public.treasury_accounts;

CREATE POLICY auth_select_organization_treasury_accounts
ON public.treasury_accounts
FOR SELECT
TO authenticated
USING (
  scope = 'organization'
  AND (
    public.can_permission('accounting.treasury.transfer')
    OR public.can_permission('accounting.treasury.main_cash.pay')
  )
  AND organization_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.organization_id = treasury_accounts.organization_id
      AND public.user_may_access_branch(b.id)
  )
);

CREATE OR REPLACE FUNCTION public.get_accessible_treasury_accounts(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_org_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT (
    public.can_permission('accounts.view')
    OR public.can_permission('procurement.payment.create')
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT organization_id
    INTO v_org_id
  FROM public.branches
  WHERE id = p_branch_id
    AND is_active;

  SELECT COALESCE(jsonb_agg(s.payload ORDER BY s.sort_scope, s.sort_branch, s.sort_kind, s.account_name), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      CASE WHEN t.scope = 'organization' THEN 0 ELSE 1 END AS sort_scope,
      CASE WHEN t.branch_id = p_branch_id THEN 0 ELSE 1 END AS sort_branch,
      CASE t.kind WHEN 'main_cash' THEN 0 WHEN 'branch_cash' THEN 1 ELSE 2 END AS sort_kind,
      t.account_name,
      jsonb_build_object(
        'id', t.id,
        'branch_id', t.branch_id,
        'branch_name', b.name,
        'organization_id', t.organization_id,
        'scope', t.scope,
        'kind', t.kind,
        'account_type', t.account_type,
        'account_name', t.account_name,
        'account_number', t.account_number,
        'code', a.code,
        'is_primary', t.is_primary,
        'is_active', t.is_active,
        'opening_balance', round(COALESCE(t.opening_balance, 0), 2),
        'balance', round(
          COALESCE(t.opening_balance, 0)
          + COALESCE(SUM(l.debit - l.credit), 0),
          2
        )
      ) AS payload
    FROM public.treasury_accounts t
    JOIN public.branches b ON b.id = t.branch_id
    JOIN public.chart_of_accounts a ON a.id = t.account_id
    LEFT JOIN public.journal_entry_lines l ON l.account_id = t.account_id
    WHERE t.is_active
      AND (
        (v_org_id IS NOT NULL AND t.organization_id = v_org_id)
        OR (v_org_id IS NULL AND t.branch_id = p_branch_id)
      )
      AND (
        (
          t.scope = 'branch'
          AND public.user_may_access_branch(t.branch_id)
        )
        OR (
          t.scope = 'organization'
          AND (public.can_permission('accounting.treasury.transfer') OR public.can_permission('accounting.treasury.main_cash.pay'))
        )
      )
    GROUP BY
      t.id, t.branch_id, b.name, t.organization_id, t.scope, t.kind,
      t.account_type, t.account_name, t.account_number, a.code, t.is_primary,
      t.opening_balance
  ) s;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_supplier_from_treasury(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_treasury_account_id uuid,
  p_purchase_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_payment_id uuid;
  v_tx_id uuid;
  v_number text;
  v_remaining numeric(14,2);
  v_purchase record;
  v_applied numeric(14,2);
  v_open numeric(14,2);
  v_total_open numeric(14,2);
  v_supplier_org uuid;
  v_source record;
  v_source_balance numeric(18,2);
  v_source_code text;
  v_payment_method text;
  v_lines jsonb := '[]'::jsonb;
  v_funding_lines jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;

  IF NOT public.can_permission('procurement.payment.create') THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'NOT_ALLOWED',
      'detail', 'Supplier payments require procurement.payment.create.'
    );
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT b.organization_id
    INTO v_supplier_org
  FROM public.branches b
  WHERE b.id = p_branch_id
    AND b.is_active;

  IF NOT EXISTS (
    SELECT 1
    FROM public.suppliers s
    WHERE s.id = p_supplier_id
      AND s.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_FOUND');
  END IF;

  -- Lock the selected funding account for the duration of the payment.
  SELECT
    t.id,
    t.branch_id,
    t.organization_id,
    t.account_id,
    t.account_type,
    t.account_name,
    t.scope,
    t.kind,
    t.is_active,
    t.opening_balance
  INTO v_source
  FROM public.treasury_accounts t
  WHERE t.id = p_treasury_account_id
  FOR UPDATE;

  IF v_source.id IS NULL OR NOT v_source.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_REQUIRED');
  END IF;

  IF v_supplier_org IS NOT NULL
     AND v_source.organization_id IS DISTINCT FROM v_supplier_org THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ORGANIZATION_MISMATCH');
  END IF;

  IF v_source.scope = 'organization' THEN
    IF NOT (public.can_permission('accounting.treasury.transfer') OR public.can_permission('accounting.treasury.main_cash.pay')) THEN
      RETURN jsonb_build_object('success', false, 'error', 'MAIN_TREASURY_PAYMENT_PERMISSION_REQUIRED', 'permission', 'accounting.treasury.main_cash.pay');
    END IF;
  ELSIF NOT public.user_may_access_branch(v_source.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_BRANCH_MISMATCH');
  END IF;

  SELECT a.code
    INTO v_source_code
  FROM public.chart_of_accounts a
  WHERE a.id = v_source.account_id
    AND a.branch_id = v_source.branch_id
    AND a.is_active;

  IF v_source_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_MAPPING_MISSING');
  END IF;

  SELECT round(
    COALESCE(v_source.opening_balance, 0)
    + COALESCE(SUM(l.debit - l.credit), 0),
    2
  )
  INTO v_source_balance
  FROM public.journal_entry_lines l
  WHERE l.account_id = v_source.account_id;

  v_source_balance := COALESCE(v_source_balance, round(COALESCE(v_source.opening_balance, 0), 2));

  IF round(p_amount, 2) > v_source_balance THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_TREASURY_BALANCE',
      'available', v_source_balance,
      'requested', round(p_amount, 2)
    );
  END IF;

  SELECT COALESCE(
    SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.returned_amount, 0)),
    0
  )
  INTO v_total_open
  FROM public.purchases s
  WHERE s.supplier_id = p_supplier_id
    AND s.branch_id = p_branch_id
    AND s.status = 'completed';

  IF p_purchase_id IS NULL THEN
    IF round(p_amount, 2) > round(v_total_open, 2) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PAYMENT_EXCEEDS_AP',
        'open', round(v_total_open, 2)
      );
    END IF;
  ELSE
    SELECT
      p.id,
      p.total,
      COALESCE(p.paid_amount, 0) AS paid_amount,
      COALESCE(p.returned_amount, 0) AS returned_amount
    INTO v_purchase
    FROM public.purchases p
    WHERE p.id = p_purchase_id
      AND p.supplier_id = p_supplier_id
      AND p.branch_id = p_branch_id
      AND p.status = 'completed'
    FOR UPDATE;

    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;

    IF round(p_amount, 2) >
       round(v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount, 2) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PAYMENT_EXCEEDS_INVOICE',
        'open', round(v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount, 2)
      );
    END IF;
  END IF;

  v_number := (public.next_document_number('supplier_payment')->>'number')::text;
  v_payment_method := CASE WHEN v_source.account_type = 'cash' THEN 'cash' ELSE 'transfer' END;

  INSERT INTO public.supplier_payments (
    supplier_id, branch_id, amount, payment_method, purchase_id,
    reference_number, notes, created_by, treasury_account_id
  )
  VALUES (
    p_supplier_id, p_branch_id, round(p_amount, 2), v_payment_method, p_purchase_id,
    v_number, p_notes, auth.uid(), v_source.id
  )
  RETURNING id INTO v_payment_id;

  v_remaining := round(p_amount, 2);

  IF p_purchase_id IS NOT NULL THEN
    v_open := round(
      v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount,
      2
    );
    v_applied := LEAST(v_remaining, v_open);
    UPDATE public.purchases
    SET paid_amount = COALESCE(paid_amount, 0) + v_applied
    WHERE id = p_purchase_id;
    v_remaining := round(v_remaining - v_applied, 2);
  ELSE
    FOR v_purchase IN
      SELECT id, total, paid_amount, returned_amount
      FROM public.purchases
      WHERE supplier_id = p_supplier_id
        AND branch_id = p_branch_id
        AND status = 'completed'
        AND (
          total - COALESCE(paid_amount, 0) - COALESCE(returned_amount, 0)
        ) > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_open := round(
        v_purchase.total
        - COALESCE(v_purchase.paid_amount, 0)
        - COALESCE(v_purchase.returned_amount, 0),
        2
      );
      v_applied := LEAST(v_remaining, v_open);
      UPDATE public.purchases
      SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = v_purchase.id;
      v_remaining := round(v_remaining - v_applied, 2);
    END LOOP;
  END IF;

  INSERT INTO public.treasury_transactions (
    branch_id, organization_id, transaction_type, from_account_id,
    from_branch_id, to_branch_id,
    amount, reference_number, notes, created_by, reference_type, reference_id
  )
  VALUES (
    p_branch_id, v_supplier_org, 'withdrawal', v_source.id,
    v_source.branch_id, NULL,
    round(p_amount, 2), v_number,
    COALESCE(p_notes, 'سداد مورد ' || v_number),
    auth.uid(), 'supplier_payment', v_payment_id
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.supplier_payments
  SET treasury_transaction_id = v_tx_id
  WHERE id = v_payment_id;

  IF v_source.branch_id = p_branch_id THEN
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_key', 'ap',
        'debit', round(p_amount, 2),
        'credit', 0,
        'supplier_id', p_supplier_id,
        'note', v_number
      ),
      jsonb_build_object(
        'account_code', v_source_code,
        'debit', 0,
        'credit', round(p_amount, 2),
        'note', v_number
      )
    );

    PERFORM public._post_journal_entry(
      p_branch_id,
      'supplier_payment',
      v_payment_id,
      v_number,
      'سداد مورد ' || v_number,
      v_lines
    );
  ELSE
    -- Supplier branch: AP decreases; clearing carries the funding from another treasury.
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_key', 'ap',
        'debit', round(p_amount, 2),
        'credit', 0,
        'supplier_id', p_supplier_id,
        'note', v_number
      ),
      jsonb_build_object(
        'account_key', 'treasury_clearing',
        'debit', 0,
        'credit', round(p_amount, 2),
        'note', v_number
      )
    );

    PERFORM public._post_journal_entry(
      p_branch_id,
      'supplier_payment',
      v_payment_id,
      v_number,
      'سداد مورد ممول من خزنة أخرى ' || v_number,
      v_lines
    );

    -- Funding branch: clearing receives the debit; actual source treasury is credited.
    v_funding_lines := jsonb_build_array(
      jsonb_build_object(
        'account_key', 'treasury_clearing',
        'debit', round(p_amount, 2),
        'credit', 0,
        'note', v_number
      ),
      jsonb_build_object(
        'account_code', v_source_code,
        'debit', 0,
        'credit', round(p_amount, 2),
        'note', v_number
      )
    );

    PERFORM public._post_journal_entry(
      v_source.branch_id,
      'supplier_payment_funding',
      v_payment_id,
      v_number,
      'تمويل سداد مورد ' || v_number,
      v_funding_lines
    );
  END IF;

  PERFORM public.log_audit_action(
    p_branch_id,
    'supplier_payment_from_treasury',
    'supplier_payment',
    v_payment_id,
    jsonb_build_object(
      'supplier_id', p_supplier_id,
      'amount', round(p_amount, 2),
      'treasury_account_id', v_source.id,
      'treasury_branch_id', v_source.branch_id,
      'treasury_scope', v_source.scope,
      'treasury_transaction_id', v_tx_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'treasury_transaction_id', v_tx_id,
    'treasury_account_id', v_source.id,
    'reference_number', v_number,
    'unapplied', v_remaining
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'TRANSACTION_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_accessible_treasury_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accessible_treasury_accounts(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pay_supplier_from_treasury(uuid,uuid,numeric,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_supplier_from_treasury(uuid,uuid,numeric,uuid,uuid,text) TO authenticated, service_role;
