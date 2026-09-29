BEGIN;

-- 1) Canonical purchase-return linkage.
-- Historical purchase_return journals were sometimes posted with reference_id NULL
-- and only the original invoice number. Link them to the purchase row without
-- changing any accounting amount, inventory quantity, or treasury balance.

CREATE OR REPLACE FUNCTION private.link_purchase_return_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, private, pg_temp
AS $function$
DECLARE
  v_purchase_id uuid;
BEGIN
  IF NEW.reference_type IS DISTINCT FROM 'purchase_return'
     OR NEW.reference_id IS NOT NULL
     OR NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT min(q.id::text)::uuid
  INTO v_purchase_id
  FROM (
    SELECT DISTINCT p.id
    FROM public.purchases p
    WHERE p.branch_id = NEW.branch_id
      AND (
        p.invoice_number = NEW.reference_number
        OR regexp_replace(p.invoice_number, '-REV-[0-9a-f-]+

  IF v_purchase_id IS NOT NULL THEN
    NEW.reference_id := v_purchase_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_link_purchase_return_reference ON public.journal_entries;
CREATE TRIGGER trg_link_purchase_return_reference
BEFORE INSERT OR UPDATE OF reference_type, reference_id, reference_number, description, branch_id
ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION private.link_purchase_return_reference();

WITH candidates AS (
  SELECT
    je.id AS journal_entry_id,
    min(p.id) AS purchase_id,
    count(DISTINCT p.id) AS purchase_count
  FROM public.journal_entries je
  JOIN public.purchases p
    ON p.branch_id = je.branch_id
   AND (
      p.invoice_number = je.reference_number
      OR regexp_replace(p.invoice_number, '-REV-[0-9a-f-]+$', '') = je.reference_number
      OR (
        je.description IS NOT NULL
        AND je.description ILIKE '%' || regexp_replace(p.invoice_number, '-REV-[0-9a-f-]+$', '') || '%'
      )
   )
  WHERE je.reference_type = 'purchase_return'
    AND je.reference_id IS NULL
  GROUP BY je.id
)
UPDATE public.journal_entries je
SET reference_id = c.purchase_id
FROM candidates c
WHERE je.id = c.journal_entry_id
  AND c.purchase_count = 1;

-- 2) Main-treasury expense movement visibility.
-- Journal lines remain the financial source of truth. treasury_transactions is
-- only the movement/audit feed used by TreasuryPage, so this trigger mirrors
-- main-treasury expense funding/reversal into that audit feed without posting
-- another journal entry.

CREATE OR REPLACE FUNCTION private.sync_main_treasury_expense_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, private, pg_temp
AS $function$
DECLARE
  v_entry public.journal_entries%ROWTYPE;
  v_treasury public.treasury_accounts%ROWTYPE;
  v_expense public.expenses%ROWTYPE;
  v_expense_branch_name text;
  v_amount numeric(14,2);
  v_tx_type text;
  v_ref_type text;
  v_notes text;
BEGIN
  SELECT * INTO v_entry
  FROM public.journal_entries
  WHERE id = NEW.journal_entry_id;

  IF v_entry.id IS NULL
     OR v_entry.reference_type NOT IN ('expense_funding','expense_funding_reversal') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_treasury
  FROM public.treasury_accounts
  WHERE account_id = NEW.account_id
    AND is_active
    AND scope = 'organization'
  LIMIT 1;

  IF v_treasury.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_entry.reference_type = 'expense_funding' THEN
    v_amount := round(GREATEST(COALESCE(NEW.credit,0)-COALESCE(NEW.debit,0),0),2);
    v_tx_type := 'withdrawal';
    v_ref_type := 'expense';
  ELSE
    v_amount := round(GREATEST(COALESCE(NEW.debit,0)-COALESCE(NEW.credit,0),0),2);
    v_tx_type := 'deposit';
    v_ref_type := 'expense_reversal';
  END IF;

  IF v_amount <= 0 OR v_entry.reference_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = v_entry.reference_id;

  SELECT name INTO v_expense_branch_name
  FROM public.branches
  WHERE id = v_expense.branch_id;

  v_notes := trim(concat(
    CASE WHEN v_entry.reference_type='expense_funding' THEN 'مصروف فرع ' ELSE 'عكس مصروف فرع ' END,
    COALESCE(v_expense_branch_name,''),
    CASE WHEN COALESCE(v_expense.description,v_expense.category) IS NOT NULL THEN ': ' ELSE '' END,
    COALESCE(v_expense.description,v_expense.category,'')
  ));

  IF NOT EXISTS (
    SELECT 1
    FROM public.treasury_transactions tx
    WHERE tx.reference_type = v_ref_type
      AND tx.reference_id = v_entry.reference_id
      AND (
        (v_tx_type='withdrawal' AND tx.from_account_id = v_treasury.id)
        OR (v_tx_type='deposit' AND tx.to_account_id = v_treasury.id)
      )
  ) THEN
    INSERT INTO public.treasury_transactions(
      branch_id,
      transaction_type,
      from_account_id,
      to_account_id,
      amount,
      reference_number,
      notes,
      created_by,
      organization_id,
      from_branch_id,
      to_branch_id,
      reference_type,
      reference_id
    ) VALUES (
      v_treasury.branch_id,
      v_tx_type,
      CASE WHEN v_tx_type='withdrawal' THEN v_treasury.id ELSE NULL END,
      CASE WHEN v_tx_type='deposit' THEN v_treasury.id ELSE NULL END,
      v_amount,
      COALESCE(v_entry.reference_number, v_expense.idempotency_key),
      v_notes,
      COALESCE(v_expense.created_by, auth.uid()),
      v_treasury.organization_id,
      CASE WHEN v_tx_type='withdrawal' THEN v_treasury.branch_id ELSE v_expense.branch_id END,
      CASE WHEN v_tx_type='withdrawal' THEN v_expense.branch_id ELSE v_treasury.branch_id END,
      v_ref_type,
      v_entry.reference_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_main_treasury_expense_movement ON public.journal_entry_lines;
CREATE TRIGGER trg_sync_main_treasury_expense_movement
AFTER INSERT OR UPDATE OF debit, credit, account_id
ON public.journal_entry_lines
FOR EACH ROW
EXECUTE FUNCTION private.sync_main_treasury_expense_movement();

-- Backfill existing main-treasury expense funding movements into the audit feed.
WITH funding_lines AS (
  SELECT
    je.reference_id AS expense_id,
    je.reference_number,
    je.reference_type,
    ta.id AS treasury_account_id,
    ta.branch_id AS treasury_branch_id,
    ta.organization_id,
    round(CASE
      WHEN je.reference_type='expense_funding' THEN GREATEST(l.credit-l.debit,0)
      ELSE GREATEST(l.debit-l.credit,0)
    END,2) AS amount,
    e.branch_id AS expense_branch_id,
    e.created_by,
    e.idempotency_key,
    COALESCE(e.description,e.category,'') AS expense_label,
    b.name AS expense_branch_name
  FROM public.journal_entries je
  JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
  JOIN public.treasury_accounts ta
    ON ta.account_id=l.account_id
   AND ta.scope='organization'
   AND ta.is_active
  JOIN public.expenses e ON e.id=je.reference_id
  LEFT JOIN public.branches b ON b.id=e.branch_id
  WHERE je.reference_type IN ('expense_funding','expense_funding_reversal')
)
INSERT INTO public.treasury_transactions(
  branch_id,transaction_type,from_account_id,to_account_id,amount,
  reference_number,notes,created_by,organization_id,from_branch_id,to_branch_id,
  reference_type,reference_id
)
SELECT
  f.treasury_branch_id,
  CASE WHEN f.reference_type='expense_funding' THEN 'withdrawal' ELSE 'deposit' END,
  CASE WHEN f.reference_type='expense_funding' THEN f.treasury_account_id ELSE NULL END,
  CASE WHEN f.reference_type='expense_funding_reversal' THEN f.treasury_account_id ELSE NULL END,
  f.amount,
  COALESCE(f.reference_number,f.idempotency_key),
  trim(concat(
    CASE WHEN f.reference_type='expense_funding' THEN 'مصروف فرع ' ELSE 'عكس مصروف فرع ' END,
    COALESCE(f.expense_branch_name,''),
    CASE WHEN f.expense_label<>'' THEN ': ' ELSE '' END,
    f.expense_label
  )),
  f.created_by,
  f.organization_id,
  CASE WHEN f.reference_type='expense_funding' THEN f.treasury_branch_id ELSE f.expense_branch_id END,
  CASE WHEN f.reference_type='expense_funding' THEN f.expense_branch_id ELSE f.treasury_branch_id END,
  CASE WHEN f.reference_type='expense_funding' THEN 'expense' ELSE 'expense_reversal' END,
  f.expense_id
FROM funding_lines f
WHERE f.amount > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.treasury_transactions tx
    WHERE tx.reference_id=f.expense_id
      AND tx.reference_type=CASE WHEN f.reference_type='expense_funding' THEN 'expense' ELSE 'expense_reversal' END
      AND (
        (f.reference_type='expense_funding' AND tx.from_account_id=f.treasury_account_id)
        OR (f.reference_type='expense_funding_reversal' AND tx.to_account_id=f.treasury_account_id)
      )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
, '') = NEW.reference_number
        OR (
          NEW.description IS NOT NULL
          AND NEW.description ILIKE '%' || regexp_replace(p.invoice_number, '-REV-[0-9a-f-]+

  IF v_purchase_id IS NOT NULL THEN
    NEW.reference_id := v_purchase_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_link_purchase_return_reference ON public.journal_entries;
CREATE TRIGGER trg_link_purchase_return_reference
BEFORE INSERT OR UPDATE OF reference_type, reference_id, reference_number, description, branch_id
ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION private.link_purchase_return_reference();

WITH candidates AS (
  SELECT
    je.id AS journal_entry_id,
    min(p.id) AS purchase_id,
    count(DISTINCT p.id) AS purchase_count
  FROM public.journal_entries je
  JOIN public.purchases p
    ON p.branch_id = je.branch_id
   AND (
      p.invoice_number = je.reference_number
      OR regexp_replace(p.invoice_number, '-REV-[0-9a-f-]+$', '') = je.reference_number
      OR (
        je.description IS NOT NULL
        AND je.description ILIKE '%' || regexp_replace(p.invoice_number, '-REV-[0-9a-f-]+$', '') || '%'
      )
   )
  WHERE je.reference_type = 'purchase_return'
    AND je.reference_id IS NULL
  GROUP BY je.id
)
UPDATE public.journal_entries je
SET reference_id = c.purchase_id
FROM candidates c
WHERE je.id = c.journal_entry_id
  AND c.purchase_count = 1;

-- 2) Main-treasury expense movement visibility.
-- Journal lines remain the financial source of truth. treasury_transactions is
-- only the movement/audit feed used by TreasuryPage, so this trigger mirrors
-- main-treasury expense funding/reversal into that audit feed without posting
-- another journal entry.

CREATE OR REPLACE FUNCTION private.sync_main_treasury_expense_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, private, pg_temp
AS $function$
DECLARE
  v_entry public.journal_entries%ROWTYPE;
  v_treasury public.treasury_accounts%ROWTYPE;
  v_expense public.expenses%ROWTYPE;
  v_expense_branch_name text;
  v_amount numeric(14,2);
  v_tx_type text;
  v_ref_type text;
  v_notes text;
BEGIN
  SELECT * INTO v_entry
  FROM public.journal_entries
  WHERE id = NEW.journal_entry_id;

  IF v_entry.id IS NULL
     OR v_entry.reference_type NOT IN ('expense_funding','expense_funding_reversal') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_treasury
  FROM public.treasury_accounts
  WHERE account_id = NEW.account_id
    AND is_active
    AND scope = 'organization'
  LIMIT 1;

  IF v_treasury.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_entry.reference_type = 'expense_funding' THEN
    v_amount := round(GREATEST(COALESCE(NEW.credit,0)-COALESCE(NEW.debit,0),0),2);
    v_tx_type := 'withdrawal';
    v_ref_type := 'expense';
  ELSE
    v_amount := round(GREATEST(COALESCE(NEW.debit,0)-COALESCE(NEW.credit,0),0),2);
    v_tx_type := 'deposit';
    v_ref_type := 'expense_reversal';
  END IF;

  IF v_amount <= 0 OR v_entry.reference_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = v_entry.reference_id;

  SELECT name INTO v_expense_branch_name
  FROM public.branches
  WHERE id = v_expense.branch_id;

  v_notes := trim(concat(
    CASE WHEN v_entry.reference_type='expense_funding' THEN 'مصروف فرع ' ELSE 'عكس مصروف فرع ' END,
    COALESCE(v_expense_branch_name,''),
    CASE WHEN COALESCE(v_expense.description,v_expense.category) IS NOT NULL THEN ': ' ELSE '' END,
    COALESCE(v_expense.description,v_expense.category,'')
  ));

  IF NOT EXISTS (
    SELECT 1
    FROM public.treasury_transactions tx
    WHERE tx.reference_type = v_ref_type
      AND tx.reference_id = v_entry.reference_id
      AND (
        (v_tx_type='withdrawal' AND tx.from_account_id = v_treasury.id)
        OR (v_tx_type='deposit' AND tx.to_account_id = v_treasury.id)
      )
  ) THEN
    INSERT INTO public.treasury_transactions(
      branch_id,
      transaction_type,
      from_account_id,
      to_account_id,
      amount,
      reference_number,
      notes,
      created_by,
      organization_id,
      from_branch_id,
      to_branch_id,
      reference_type,
      reference_id
    ) VALUES (
      v_treasury.branch_id,
      v_tx_type,
      CASE WHEN v_tx_type='withdrawal' THEN v_treasury.id ELSE NULL END,
      CASE WHEN v_tx_type='deposit' THEN v_treasury.id ELSE NULL END,
      v_amount,
      COALESCE(v_entry.reference_number, v_expense.idempotency_key),
      v_notes,
      COALESCE(v_expense.created_by, auth.uid()),
      v_treasury.organization_id,
      CASE WHEN v_tx_type='withdrawal' THEN v_treasury.branch_id ELSE v_expense.branch_id END,
      CASE WHEN v_tx_type='withdrawal' THEN v_expense.branch_id ELSE v_treasury.branch_id END,
      v_ref_type,
      v_entry.reference_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_main_treasury_expense_movement ON public.journal_entry_lines;
CREATE TRIGGER trg_sync_main_treasury_expense_movement
AFTER INSERT OR UPDATE OF debit, credit, account_id
ON public.journal_entry_lines
FOR EACH ROW
EXECUTE FUNCTION private.sync_main_treasury_expense_movement();

-- Backfill existing main-treasury expense funding movements into the audit feed.
WITH funding_lines AS (
  SELECT
    je.reference_id AS expense_id,
    je.reference_number,
    je.reference_type,
    ta.id AS treasury_account_id,
    ta.branch_id AS treasury_branch_id,
    ta.organization_id,
    round(CASE
      WHEN je.reference_type='expense_funding' THEN GREATEST(l.credit-l.debit,0)
      ELSE GREATEST(l.debit-l.credit,0)
    END,2) AS amount,
    e.branch_id AS expense_branch_id,
    e.created_by,
    e.idempotency_key,
    COALESCE(e.description,e.category,'') AS expense_label,
    b.name AS expense_branch_name
  FROM public.journal_entries je
  JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
  JOIN public.treasury_accounts ta
    ON ta.account_id=l.account_id
   AND ta.scope='organization'
   AND ta.is_active
  JOIN public.expenses e ON e.id=je.reference_id
  LEFT JOIN public.branches b ON b.id=e.branch_id
  WHERE je.reference_type IN ('expense_funding','expense_funding_reversal')
)
INSERT INTO public.treasury_transactions(
  branch_id,transaction_type,from_account_id,to_account_id,amount,
  reference_number,notes,created_by,organization_id,from_branch_id,to_branch_id,
  reference_type,reference_id
)
SELECT
  f.treasury_branch_id,
  CASE WHEN f.reference_type='expense_funding' THEN 'withdrawal' ELSE 'deposit' END,
  CASE WHEN f.reference_type='expense_funding' THEN f.treasury_account_id ELSE NULL END,
  CASE WHEN f.reference_type='expense_funding_reversal' THEN f.treasury_account_id ELSE NULL END,
  f.amount,
  COALESCE(f.reference_number,f.idempotency_key),
  trim(concat(
    CASE WHEN f.reference_type='expense_funding' THEN 'مصروف فرع ' ELSE 'عكس مصروف فرع ' END,
    COALESCE(f.expense_branch_name,''),
    CASE WHEN f.expense_label<>'' THEN ': ' ELSE '' END,
    f.expense_label
  )),
  f.created_by,
  f.organization_id,
  CASE WHEN f.reference_type='expense_funding' THEN f.treasury_branch_id ELSE f.expense_branch_id END,
  CASE WHEN f.reference_type='expense_funding' THEN f.expense_branch_id ELSE f.treasury_branch_id END,
  CASE WHEN f.reference_type='expense_funding' THEN 'expense' ELSE 'expense_reversal' END,
  f.expense_id
FROM funding_lines f
WHERE f.amount > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.treasury_transactions tx
    WHERE tx.reference_id=f.expense_id
      AND tx.reference_type=CASE WHEN f.reference_type='expense_funding' THEN 'expense' ELSE 'expense_reversal' END
      AND (
        (f.reference_type='expense_funding' AND tx.from_account_id=f.treasury_account_id)
        OR (f.reference_type='expense_funding_reversal' AND tx.to_account_id=f.treasury_account_id)
      )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
, '') || '%'
        )
      )
    LIMIT 2
  ) q
  HAVING count(*) = 1;

  IF v_purchase_id IS NOT NULL THEN
    NEW.reference_id := v_purchase_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_link_purchase_return_reference ON public.journal_entries;
CREATE TRIGGER trg_link_purchase_return_reference
BEFORE INSERT OR UPDATE OF reference_type, reference_id, reference_number, description, branch_id
ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION private.link_purchase_return_reference();

WITH candidates AS (
  SELECT
    je.id AS journal_entry_id,
    min(p.id) AS purchase_id,
    count(DISTINCT p.id) AS purchase_count
  FROM public.journal_entries je
  JOIN public.purchases p
    ON p.branch_id = je.branch_id
   AND (
      p.invoice_number = je.reference_number
      OR regexp_replace(p.invoice_number, '-REV-[0-9a-f-]+$', '') = je.reference_number
      OR (
        je.description IS NOT NULL
        AND je.description ILIKE '%' || regexp_replace(p.invoice_number, '-REV-[0-9a-f-]+$', '') || '%'
      )
   )
  WHERE je.reference_type = 'purchase_return'
    AND je.reference_id IS NULL
  GROUP BY je.id
)
UPDATE public.journal_entries je
SET reference_id = c.purchase_id
FROM candidates c
WHERE je.id = c.journal_entry_id
  AND c.purchase_count = 1;

-- 2) Main-treasury expense movement visibility.
-- Journal lines remain the financial source of truth. treasury_transactions is
-- only the movement/audit feed used by TreasuryPage, so this trigger mirrors
-- main-treasury expense funding/reversal into that audit feed without posting
-- another journal entry.

CREATE OR REPLACE FUNCTION private.sync_main_treasury_expense_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, private, pg_temp
AS $function$
DECLARE
  v_entry public.journal_entries%ROWTYPE;
  v_treasury public.treasury_accounts%ROWTYPE;
  v_expense public.expenses%ROWTYPE;
  v_expense_branch_name text;
  v_amount numeric(14,2);
  v_tx_type text;
  v_ref_type text;
  v_notes text;
BEGIN
  SELECT * INTO v_entry
  FROM public.journal_entries
  WHERE id = NEW.journal_entry_id;

  IF v_entry.id IS NULL
     OR v_entry.reference_type NOT IN ('expense_funding','expense_funding_reversal') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_treasury
  FROM public.treasury_accounts
  WHERE account_id = NEW.account_id
    AND is_active
    AND scope = 'organization'
  LIMIT 1;

  IF v_treasury.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_entry.reference_type = 'expense_funding' THEN
    v_amount := round(GREATEST(COALESCE(NEW.credit,0)-COALESCE(NEW.debit,0),0),2);
    v_tx_type := 'withdrawal';
    v_ref_type := 'expense';
  ELSE
    v_amount := round(GREATEST(COALESCE(NEW.debit,0)-COALESCE(NEW.credit,0),0),2);
    v_tx_type := 'deposit';
    v_ref_type := 'expense_reversal';
  END IF;

  IF v_amount <= 0 OR v_entry.reference_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = v_entry.reference_id;

  SELECT name INTO v_expense_branch_name
  FROM public.branches
  WHERE id = v_expense.branch_id;

  v_notes := trim(concat(
    CASE WHEN v_entry.reference_type='expense_funding' THEN 'مصروف فرع ' ELSE 'عكس مصروف فرع ' END,
    COALESCE(v_expense_branch_name,''),
    CASE WHEN COALESCE(v_expense.description,v_expense.category) IS NOT NULL THEN ': ' ELSE '' END,
    COALESCE(v_expense.description,v_expense.category,'')
  ));

  IF NOT EXISTS (
    SELECT 1
    FROM public.treasury_transactions tx
    WHERE tx.reference_type = v_ref_type
      AND tx.reference_id = v_entry.reference_id
      AND (
        (v_tx_type='withdrawal' AND tx.from_account_id = v_treasury.id)
        OR (v_tx_type='deposit' AND tx.to_account_id = v_treasury.id)
      )
  ) THEN
    INSERT INTO public.treasury_transactions(
      branch_id,
      transaction_type,
      from_account_id,
      to_account_id,
      amount,
      reference_number,
      notes,
      created_by,
      organization_id,
      from_branch_id,
      to_branch_id,
      reference_type,
      reference_id
    ) VALUES (
      v_treasury.branch_id,
      v_tx_type,
      CASE WHEN v_tx_type='withdrawal' THEN v_treasury.id ELSE NULL END,
      CASE WHEN v_tx_type='deposit' THEN v_treasury.id ELSE NULL END,
      v_amount,
      COALESCE(v_entry.reference_number, v_expense.idempotency_key),
      v_notes,
      COALESCE(v_expense.created_by, auth.uid()),
      v_treasury.organization_id,
      CASE WHEN v_tx_type='withdrawal' THEN v_treasury.branch_id ELSE v_expense.branch_id END,
      CASE WHEN v_tx_type='withdrawal' THEN v_expense.branch_id ELSE v_treasury.branch_id END,
      v_ref_type,
      v_entry.reference_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_main_treasury_expense_movement ON public.journal_entry_lines;
CREATE TRIGGER trg_sync_main_treasury_expense_movement
AFTER INSERT OR UPDATE OF debit, credit, account_id
ON public.journal_entry_lines
FOR EACH ROW
EXECUTE FUNCTION private.sync_main_treasury_expense_movement();

-- Backfill existing main-treasury expense funding movements into the audit feed.
WITH funding_lines AS (
  SELECT
    je.reference_id AS expense_id,
    je.reference_number,
    je.reference_type,
    ta.id AS treasury_account_id,
    ta.branch_id AS treasury_branch_id,
    ta.organization_id,
    round(CASE
      WHEN je.reference_type='expense_funding' THEN GREATEST(l.credit-l.debit,0)
      ELSE GREATEST(l.debit-l.credit,0)
    END,2) AS amount,
    e.branch_id AS expense_branch_id,
    e.created_by,
    e.idempotency_key,
    COALESCE(e.description,e.category,'') AS expense_label,
    b.name AS expense_branch_name
  FROM public.journal_entries je
  JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
  JOIN public.treasury_accounts ta
    ON ta.account_id=l.account_id
   AND ta.scope='organization'
   AND ta.is_active
  JOIN public.expenses e ON e.id=je.reference_id
  LEFT JOIN public.branches b ON b.id=e.branch_id
  WHERE je.reference_type IN ('expense_funding','expense_funding_reversal')
)
INSERT INTO public.treasury_transactions(
  branch_id,transaction_type,from_account_id,to_account_id,amount,
  reference_number,notes,created_by,organization_id,from_branch_id,to_branch_id,
  reference_type,reference_id
)
SELECT
  f.treasury_branch_id,
  CASE WHEN f.reference_type='expense_funding' THEN 'withdrawal' ELSE 'deposit' END,
  CASE WHEN f.reference_type='expense_funding' THEN f.treasury_account_id ELSE NULL END,
  CASE WHEN f.reference_type='expense_funding_reversal' THEN f.treasury_account_id ELSE NULL END,
  f.amount,
  COALESCE(f.reference_number,f.idempotency_key),
  trim(concat(
    CASE WHEN f.reference_type='expense_funding' THEN 'مصروف فرع ' ELSE 'عكس مصروف فرع ' END,
    COALESCE(f.expense_branch_name,''),
    CASE WHEN f.expense_label<>'' THEN ': ' ELSE '' END,
    f.expense_label
  )),
  f.created_by,
  f.organization_id,
  CASE WHEN f.reference_type='expense_funding' THEN f.treasury_branch_id ELSE f.expense_branch_id END,
  CASE WHEN f.reference_type='expense_funding' THEN f.expense_branch_id ELSE f.treasury_branch_id END,
  CASE WHEN f.reference_type='expense_funding' THEN 'expense' ELSE 'expense_reversal' END,
  f.expense_id
FROM funding_lines f
WHERE f.amount > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.treasury_transactions tx
    WHERE tx.reference_id=f.expense_id
      AND tx.reference_type=CASE WHEN f.reference_type='expense_funding' THEN 'expense' ELSE 'expense_reversal' END
      AND (
        (f.reference_type='expense_funding' AND tx.from_account_id=f.treasury_account_id)
        OR (f.reference_type='expense_funding_reversal' AND tx.to_account_id=f.treasury_account_id)
      )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
