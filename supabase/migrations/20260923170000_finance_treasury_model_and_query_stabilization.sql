-- Finance stabilization:
-- 1) explicit branch vault / bank / organization main treasury model
-- 2) supplier payments funded by a real treasury account
-- 3) safe cross-branch/main-treasury transfers through internal clearing
-- 4) materialize trial-balance history bound once per call
--
-- Production is NOT changed by this file until the migration is explicitly applied.

BEGIN;

-- ---------------------------------------------------------------------------
-- Treasury account model
-- ---------------------------------------------------------------------------

ALTER TABLE public.treasury_accounts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'branch',
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

UPDATE public.treasury_accounts t
SET
  organization_id = COALESCE(t.organization_id, b.organization_id),
  scope = 'branch',
  kind = COALESCE(
    t.kind,
    CASE WHEN t.account_type = 'bank' THEN 'bank' ELSE 'branch_cash' END
  ),
  is_primary = CASE
    WHEN t.account_type = 'cash' AND COALESCE(t.kind, 'branch_cash') = 'branch_cash' THEN true
    ELSE t.is_primary
  END
FROM public.branches b
WHERE b.id = t.branch_id;

-- Backward compatibility: legacy callers and integration fixtures still insert
-- treasury_accounts using the original columns only. Populate the extended
-- model automatically instead of forcing every existing caller to change.
CREATE OR REPLACE FUNCTION public.treasury_accounts_fill_model_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  NEW.scope := COALESCE(NULLIF(NEW.scope, ''), 'branch');

  IF NEW.kind IS NULL OR btrim(NEW.kind) = '' THEN
    NEW.kind := CASE
      WHEN NEW.account_type = 'bank' THEN 'bank'
      ELSE 'branch_cash'
    END;
  END IF;

  IF NEW.organization_id IS NULL AND NEW.branch_id IS NOT NULL THEN
    SELECT b.organization_id
      INTO NEW.organization_id
    FROM public.branches b
    WHERE b.id = NEW.branch_id;
  END IF;

  IF NEW.scope = 'branch' AND NEW.kind = 'branch_cash' THEN
    IF EXISTS (
      SELECT 1
      FROM public.treasury_accounts t
      WHERE t.branch_id = NEW.branch_id
        AND t.scope = 'branch'
        AND t.kind = 'branch_cash'
        AND t.is_primary
        AND t.id IS DISTINCT FROM NEW.id
    ) THEN
      NEW.is_primary := false;
    ELSE
      NEW.is_primary := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS treasury_accounts_fill_model_defaults
  ON public.treasury_accounts;
CREATE TRIGGER treasury_accounts_fill_model_defaults
BEFORE INSERT OR UPDATE OF branch_id, account_type, organization_id, scope, kind
ON public.treasury_accounts
FOR EACH ROW
EXECUTE FUNCTION public.treasury_accounts_fill_model_defaults();

ALTER TABLE public.treasury_accounts
  ALTER COLUMN kind SET NOT NULL;

ALTER TABLE public.treasury_accounts
  DROP CONSTRAINT IF EXISTS treasury_accounts_scope_check,
  ADD CONSTRAINT treasury_accounts_scope_check
    CHECK (scope IN ('branch','organization'));

ALTER TABLE public.treasury_accounts
  DROP CONSTRAINT IF EXISTS treasury_accounts_kind_check,
  ADD CONSTRAINT treasury_accounts_kind_check
    CHECK (kind IN ('branch_cash','main_cash','bank'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_main_cash_org
  ON public.treasury_accounts(organization_id)
  WHERE scope = 'organization'
    AND kind = 'main_cash'
    AND organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_branch_cash
  ON public.treasury_accounts(branch_id)
  WHERE scope = 'branch'
    AND kind = 'branch_cash'
    AND is_primary;

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_org_scope
  ON public.treasury_accounts(organization_id, scope, kind)
  WHERE is_active;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS treasury_account_id uuid
    REFERENCES public.treasury_accounts(id),
  ADD COLUMN IF NOT EXISTS treasury_transaction_id uuid
    REFERENCES public.treasury_transactions(id);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_treasury_account
  ON public.supplier_payments(treasury_account_id)
  WHERE treasury_account_id IS NOT NULL;

ALTER TABLE public.treasury_transactions
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS from_branch_id uuid
    REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_branch_id uuid
    REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id uuid;

UPDATE public.treasury_transactions tx
SET
  organization_id = COALESCE(tx.organization_id, b.organization_id),
  from_branch_id = COALESCE(
    tx.from_branch_id,
    (SELECT ta.branch_id FROM public.treasury_accounts ta WHERE ta.id = tx.from_account_id)
  ),
  to_branch_id = COALESCE(
    tx.to_branch_id,
    (SELECT ta.branch_id FROM public.treasury_accounts ta WHERE ta.id = tx.to_account_id)
  )
FROM public.branches b
WHERE b.id = tx.branch_id;

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_reference
  ON public.treasury_transactions(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_from_branch
  ON public.treasury_transactions(from_branch_id, created_at DESC)
  WHERE from_branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_to_branch
  ON public.treasury_transactions(to_branch_id, created_at DESC)
  WHERE to_branch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Accounting structure: internal treasury clearing per branch.
-- 1190 nets to zero on consolidated books; it is not revenue or expense.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_chart_of_accounts(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.chart_of_accounts
    (branch_id, code, name, name_en, account_type, is_system)
  SELECT p_branch_id, c.code, c.name, c.name_en, c.account_type, c.is_system
  FROM (VALUES
    ('1000','النقدية بالخزينة','Cash on Hand','asset',true),
    ('1010','البنك','Bank','asset',true),
    ('1100','العملاء (ذمم مدينة)','Accounts Receivable','asset',true),
    ('1190','مقاصة الخزائن الداخلية','Internal Treasury Clearing','asset',true),
    ('1200','المخزون (بضاعة جاهزة)','Finished Goods Inventory','asset',true),
    ('1210','مخزون المواد الخام','Raw Materials Inventory','asset',false),
    ('1300','مصنع تحت التشغيل','Work In Progress','asset',true),
    ('1500','الأصول الثابتة','Fixed Assets','asset',false),
    ('1520','مجمع إهلاك الأصول الثابتة','Accumulated Depreciation','asset',true),
    ('2000','الموردون (ذمم دائنة)','Accounts Payable','liability',true),
    ('2100','ضريبة القيمة المضافة المستحقة','VAT Payable','liability',true),
    ('2110','ضريبة القيمة المضافة (مشتريات)','Input VAT','liability',true),
    ('2300','القروض','Loans','liability',false),
    ('3000','رأس المال','Capital','equity',false),
    ('3100','الأرباح المحتجزة','Retained Earnings','equity',false),
    ('4000','إيرادات المبيعات','Sales Revenue','income',true),
    ('4100','خصم مسموح به','Discount Given','income',true),
    ('4110','خصم مكتسب','Purchase Discount','income',true),
    ('4200','إيرادات أخرى','Other Income','income',false),
    ('5000','تكلفة البضاعة المباعة','Cost of Goods Sold','expense',true),
    ('5100','مصاريف تشغيلية','Operating Expenses','expense',false),
    ('5200','أجور ورواتب','Salaries & Wages','expense',false),
    ('5300','إيجار','Rent','expense',false),
    ('5400','مرافق','Utilities','expense',false),
    ('5500','فروق جرد المخزون','Stock Variance','expense',true),
    ('5600','مصاريف الإهلاك','Depreciation Expense','expense',true),
    ('5700','مصاريف البنك','Bank Charges','expense',true),
    ('5900','مصاريف أخرى','Other Expenses','expense',false)
  ) AS c(code, name, name_en, account_type, is_system)
  ON CONFLICT (branch_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    account_type = EXCLUDED.account_type,
    is_system = COALESCE(public.chart_of_accounts.is_system, EXCLUDED.is_system),
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_account_mappings(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  PERFORM public.ensure_chart_of_accounts(p_branch_id);

  INSERT INTO public.account_mappings (branch_id, semantic_key, account_id)
  SELECT p_branch_id, m.semantic_key, a.id
  FROM (VALUES
    ('cash','1000'),('bank','1010'),('ar','1100'),('treasury_clearing','1190'),('ap','2000'),
    ('inventory_fg','1200'),('inventory_rm','1210'),('wip','1300'),
    ('fixed_assets','1500'),('accumulated_depreciation','1520'),
    ('vat_payable','2100'),('vat_receivable','2110'),
    ('capital','3000'),('retained','3100'),
    ('revenue','4000'),('discount_given','4100'),('discount_received','4110'),
    ('other_income','4200'),
    ('cogs','5000'),('expense_default','5100'),('expense_operating','5100'),
    ('stock_variance','5500'),('depreciation_expense','5600'),('bank_charges','5700')
  ) AS m(semantic_key, code)
  JOIN public.chart_of_accounts a
    ON a.branch_id = p_branch_id
   AND a.code = m.code
  ON CONFLICT (branch_id, semantic_key) DO UPDATE SET
    account_id = EXCLUDED.account_id,
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_treasury_accounts(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_org_id uuid;
  v_main_branch_id uuid;
  v_main_account_id uuid;
BEGIN
  PERFORM public.ensure_chart_of_accounts(p_branch_id);
  PERFORM public.seed_account_mappings(p_branch_id);

  SELECT organization_id
    INTO v_org_id
  FROM public.branches
  WHERE id = p_branch_id;

  INSERT INTO public.treasury_accounts
    (branch_id, organization_id, account_id, account_type, account_name, scope, kind, is_primary)
  SELECT
    p_branch_id,
    v_org_id,
    m.account_id,
    m.semantic_key,
    a.name,
    'branch',
    CASE WHEN m.semantic_key = 'cash' THEN 'branch_cash' ELSE 'bank' END,
    (m.semantic_key = 'cash')
  FROM public.account_mappings m
  JOIN public.chart_of_accounts a ON a.id = m.account_id
  WHERE m.branch_id = p_branch_id
    AND m.semantic_key IN ('cash', 'bank')
  ON CONFLICT (branch_id, account_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    account_type = EXCLUDED.account_type,
    account_name = EXCLUDED.account_name,
    scope = EXCLUDED.scope,
    kind = EXCLUDED.kind,
    is_primary = EXCLUDED.is_primary,
    updated_at = now();

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.treasury_accounts
    WHERE organization_id = v_org_id
      AND scope = 'organization'
      AND kind = 'main_cash'
  ) THEN
    RETURN;
  END IF;

  SELECT b.id
    INTO v_main_branch_id
  FROM public.branches b
  WHERE b.organization_id = v_org_id
    AND b.is_active
  ORDER BY b.created_at ASC NULLS LAST, b.id
  LIMIT 1;

  IF v_main_branch_id IS NULL THEN
    v_main_branch_id := p_branch_id;
  END IF;

  INSERT INTO public.chart_of_accounts
    (branch_id, code, name, name_en, account_type, is_system, is_active)
  VALUES
    (v_main_branch_id, '1020', 'الخزنة الرئيسية', 'Main Treasury', 'asset', true, true)
  ON CONFLICT (branch_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    account_type = 'asset',
    is_system = true,
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_main_account_id;

  INSERT INTO public.treasury_accounts
    (branch_id, organization_id, account_id, account_type, account_name, scope, kind, is_primary)
  VALUES
    (v_main_branch_id, v_org_id, v_main_account_id, 'cash', 'الخزنة الرئيسية', 'organization', 'main_cash', true)
  ON CONFLICT (branch_id, account_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    account_type = EXCLUDED.account_type,
    account_name = EXCLUDED.account_name,
    scope = EXCLUDED.scope,
    kind = EXCLUDED.kind,
    is_primary = true,
    is_active = true,
    updated_at = now();
END;
$function$;

-- Backfill current branches. Existing cash/bank balances are not changed.
SELECT public.seed_treasury_accounts(b.id)
FROM public.branches b
ORDER BY b.created_at ASC NULLS LAST, b.id;

-- ---------------------------------------------------------------------------
-- Narrow treasury transaction visibility to either side of a transfer.
-- This preserves branch isolation while allowing a destination branch to see
-- a transfer that originated from another accessible branch/main treasury.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS auth_select_treasury_transactions
  ON public.treasury_transactions;

CREATE POLICY auth_select_treasury_transactions
ON public.treasury_transactions
FOR SELECT
TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  OR EXISTS (
    SELECT 1
    FROM public.treasury_accounts ta
    WHERE ta.id = treasury_transactions.from_account_id
      AND public.user_may_access_branch(ta.branch_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.treasury_accounts ta
    WHERE ta.id = treasury_transactions.to_account_id
      AND public.user_may_access_branch(ta.branch_id)
  )
);

-- Organization-scoped main treasury stays hidden from ordinary branch users.
-- Users with treasury-transfer permission may read it only when they can access
-- at least one branch in the same organization.
DROP POLICY IF EXISTS auth_select_organization_treasury_accounts
  ON public.treasury_accounts;

CREATE POLICY auth_select_organization_treasury_accounts
ON public.treasury_accounts
FOR SELECT
TO authenticated
USING (
  scope = 'organization'
  AND public.can_permission('accounting.treasury.transfer')
  AND organization_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.organization_id = treasury_accounts.organization_id
      AND public.user_may_access_branch(b.id)
  )
);

-- ---------------------------------------------------------------------------
-- Accessible treasury accounts + live balances.
-- Main treasury is visible only to users explicitly allowed to transfer treasury.
-- ---------------------------------------------------------------------------

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
          AND public.can_permission('accounting.treasury.transfer')
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

REVOKE ALL ON FUNCTION public.get_accessible_treasury_accounts(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accessible_treasury_accounts(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Supplier payment funded by a real treasury account.
-- ---------------------------------------------------------------------------

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
    IF NOT public.can_permission('accounting.treasury.transfer') THEN
      RETURN jsonb_build_object('success', false, 'error', 'TREASURY_PERMISSION_REQUIRED');
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

REVOKE ALL ON FUNCTION public.pay_supplier_from_treasury(uuid,uuid,numeric,uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_supplier_from_treasury(uuid,uuid,numeric,uuid,uuid,text)
  TO authenticated, service_role;

-- Compatibility path: every legacy pay_supplier call is now funded by the
-- branch's real default cash/bank treasury instead of a floating GL key.
CREATE OR REPLACE FUNCTION public.pay_supplier(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'cash',
  p_purchase_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_treasury_account_id uuid;
BEGIN
  SELECT t.id
    INTO v_treasury_account_id
  FROM public.treasury_accounts t
  WHERE t.branch_id = p_branch_id
    AND t.scope = 'branch'
    AND t.is_active
    AND t.kind = CASE
      WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'branch_cash'
      ELSE 'bank'
    END
  ORDER BY t.is_primary DESC, t.created_at ASC, t.id
  LIMIT 1;

  IF v_treasury_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TREASURY_ACCOUNT_REQUIRED'
    );
  END IF;

  RETURN public.pay_supplier_from_treasury(
    p_supplier_id,
    p_branch_id,
    p_amount,
    v_treasury_account_id,
    p_purchase_id,
    p_notes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_supplier(uuid,uuid,numeric,text,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_supplier(uuid,uuid,numeric,text,uuid,text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cross-branch / main-treasury transfer.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_treasury_transfer_v2(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from record;
  v_to record;
  v_number text;
  v_tx_id uuid;
  v_source_balance numeric(18,2);
  v_from_code text;
  v_to_code text;
  v_lines jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('accounting.treasury.transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;

  IF p_from_account_id IS NULL OR p_to_account_id IS NULL
     OR p_from_account_id = p_to_account_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAME_ACCOUNT');
  END IF;

  -- Deterministic row-lock order prevents reverse-transfer deadlocks.
  PERFORM 1
  FROM public.treasury_accounts t
  WHERE t.id IN (p_from_account_id, p_to_account_id)
  ORDER BY t.id
  FOR UPDATE;

  SELECT
    t.*, b.organization_id AS branch_org_id, a.code AS account_code
  INTO v_from
  FROM public.treasury_accounts t
  JOIN public.branches b ON b.id = t.branch_id
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  WHERE t.id = p_from_account_id;

  SELECT
    t.*, b.organization_id AS branch_org_id, a.code AS account_code
  INTO v_to
  FROM public.treasury_accounts t
  JOIN public.branches b ON b.id = t.branch_id
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  WHERE t.id = p_to_account_id;

  IF v_from.id IS NULL OR v_to.id IS NULL
     OR NOT v_from.is_active OR NOT v_to.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_NOT_FOUND');
  END IF;

  IF v_from.organization_id IS DISTINCT FROM v_to.organization_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ORGANIZATION_MISMATCH');
  END IF;

  IF v_from.scope = 'branch'
     AND NOT public.user_may_access_branch(v_from.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FROM_BRANCH_MISMATCH');
  END IF;

  IF v_to.scope = 'branch'
     AND NOT public.user_may_access_branch(v_to.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TO_BRANCH_MISMATCH');
  END IF;

  SELECT round(
    COALESCE(v_from.opening_balance, 0)
    + COALESCE(SUM(l.debit - l.credit), 0),
    2
  )
  INTO v_source_balance
  FROM public.journal_entry_lines l
  WHERE l.account_id = v_from.account_id;

  v_source_balance := COALESCE(
    v_source_balance,
    round(COALESCE(v_from.opening_balance, 0), 2)
  );

  IF round(p_amount, 2) > v_source_balance THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_TREASURY_BALANCE',
      'available', v_source_balance,
      'requested', round(p_amount, 2)
    );
  END IF;

  v_from_code := v_from.account_code;
  v_to_code := v_to.account_code;
  v_number := (public.next_document_number('treasury')->>'number')::text;

  INSERT INTO public.treasury_transactions (
    branch_id, organization_id, transaction_type,
    from_account_id, to_account_id,
    from_branch_id, to_branch_id,
    amount,
    reference_number, notes, created_by,
    reference_type
  )
  VALUES (
    v_from.branch_id,
    v_from.organization_id,
    'transfer',
    v_from.id,
    v_to.id,
    v_from.branch_id,
    v_to.branch_id,
    round(p_amount, 2),
    v_number,
    p_notes,
    auth.uid(),
    'treasury_transfer'
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.treasury_transactions
  SET reference_id = v_tx_id
  WHERE id = v_tx_id;

  IF v_from.branch_id = v_to.branch_id THEN
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_to_code,
        'debit', round(p_amount, 2),
        'credit', 0,
        'note', 'تحويل ' || v_number
      ),
      jsonb_build_object(
        'account_code', v_from_code,
        'debit', 0,
        'credit', round(p_amount, 2),
        'note', 'تحويل ' || v_number
      )
    );

    PERFORM public._post_journal_entry(
      v_from.branch_id,
      'treasury_transfer',
      v_tx_id,
      v_number,
      'تحويل خزينة ' || v_number,
      v_lines
    );
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_key', 'treasury_clearing',
        'debit', round(p_amount, 2),
        'credit', 0,
        'note', v_number
      ),
      jsonb_build_object(
        'account_code', v_from_code,
        'debit', 0,
        'credit', round(p_amount, 2),
        'note', v_number
      )
    );

    PERFORM public._post_journal_entry(
      v_from.branch_id,
      'treasury_transfer_out',
      v_tx_id,
      v_number,
      'تحويل خزينة صادر ' || v_number,
      v_lines
    );

    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_to_code,
        'debit', round(p_amount, 2),
        'credit', 0,
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
      v_to.branch_id,
      'treasury_transfer_in',
      v_tx_id,
      v_number,
      'تحويل خزينة وارد ' || v_number,
      v_lines
    );
  END IF;

  PERFORM public.log_audit_action(
    v_from.branch_id,
    'treasury_transfer',
    'treasury_transaction',
    v_tx_id,
    jsonb_build_object(
      'from_account_id', v_from.id,
      'to_account_id', v_to.id,
      'from_branch_id', v_from.branch_id,
      'to_branch_id', v_to.branch_id,
      'amount', round(p_amount, 2)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'reference_number', v_number
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'TRANSACTION_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.process_treasury_transfer_v2(uuid,uuid,numeric,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_treasury_transfer_v2(uuid,uuid,numeric,text)
  TO authenticated, service_role;


-- Compatibility path: legacy same-branch transfer callers also inherit the
-- balance guard and cross-branch-safe implementation.
CREATE OR REPLACE FUNCTION public.process_transfer(
  p_branch_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from_branch uuid;
BEGIN
  SELECT branch_id
    INTO v_from_branch
  FROM public.treasury_accounts
  WHERE id = p_from_account_id;

  IF v_from_branch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_NOT_FOUND');
  END IF;

  IF p_branch_id IS NOT NULL
     AND p_branch_id <> v_from_branch
     AND NOT public.user_may_access_branch(v_from_branch) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  RETURN public.process_treasury_transfer_v2(
    p_from_account_id,
    p_to_account_id,
    p_amount,
    p_notes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.process_transfer(uuid,uuid,uuid,numeric,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_transfer(uuid,uuid,uuid,numeric,text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Treasury balances now include opening balance explicitly.
-- Current Production opening balances are all zero, so this does not rewrite
-- present balances; it fixes the contract for future opening balances.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_treasury_balances(p_branch_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO public, pg_temp
AS $function$
SELECT COALESCE(jsonb_agg(s.jb ORDER BY s.jb->>'account_type', s.jb->>'account_name'), '[]'::jsonb)
FROM (
  SELECT jsonb_build_object(
    'id', t.id,
    'account_type', t.account_type,
    'account_name', t.account_name,
    'account_number', t.account_number,
    'scope', t.scope,
    'kind', t.kind,
    'code', a.code,
    'is_active', t.is_active,
    'opening_balance', round(COALESCE(t.opening_balance, 0), 2),
    'balance', round(
      COALESCE(t.opening_balance, 0)
      + COALESCE(SUM(l.debit - l.credit), 0),
      2
    )
  ) AS jb
  FROM public.treasury_accounts t
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id
  WHERE t.branch_id = p_branch_id
    AND t.scope = 'branch'
  GROUP BY
    t.id, t.account_type, t.account_name, t.account_number,
    t.scope, t.kind, a.code, t.is_active, t.opening_balance
) s;
$function$;

REVOKE ALL ON FUNCTION public.get_treasury_balances(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_treasury_balances(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Trial balance: evaluate permission-aware history bound once.
-- Read-only Production proof before this migration:
-- current ~243 ms vs equivalent materialized bound ~14.9 ms;
-- exact JSON hash equality on Cleopatra.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_trial_balance(
  p_branch_id uuid,
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO public, pg_temp
AS $function$
WITH history_bound AS MATERIALIZED (
  SELECT public.history_clamp_as_of(p_to_date) AS to_date
),
rows AS MATERIALIZED (
  SELECT
    a.code,
    a.name,
    a.name_en,
    a.account_type,
    round(COALESCE(SUM(l.debit), 0), 2) AS debit,
    round(COALESCE(SUM(l.credit), 0), 2) AS credit,
    round(
      COALESCE(SUM(l.debit), 0)
      - COALESCE(SUM(l.credit), 0),
      2
    ) AS balance
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    CROSS JOIN history_bound hb
    WHERE j.branch_id = p_branch_id
      AND j.entry_date <= hb.to_date
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id
    AND a.is_active
  GROUP BY a.code, a.name, a.name_en, a.account_type
  HAVING COALESCE(SUM(l.debit), 0) <> 0
      OR COALESCE(SUM(l.credit), 0) <> 0
)
SELECT COALESCE(jsonb_agg(rows ORDER BY code), '[]'::jsonb)
FROM rows;
$function$;

REVOKE ALL ON FUNCTION public.get_trial_balance(uuid,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trial_balance(uuid,date)
  TO authenticated, service_role;

COMMIT;
