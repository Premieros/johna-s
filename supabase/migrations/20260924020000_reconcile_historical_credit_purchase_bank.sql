BEGIN;

-- Historical credit-purchase bank reconciliation.
-- Forward-only and non-destructive:
--   * never delete or mutate original journal entries
--   * post a compensating Bank debit / AP credit only for completed/partial
--     credit purchases whose own purchase journal incorrectly credited bank
--   * normalize paid_amount to zero only after the compensating entry is posted
--   * returned purchases are excluded because their purchase journals may already
--     be reversed by purchase_return entries
--   * credit purchases with no direct bank impact are left untouched and flagged
--     for manual review instead of fabricating accounting history

CREATE OR REPLACE FUNCTION private.reconcile_credit_purchase_bank_history(
  p_purchase_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_purchase record;
  v_bank_net numeric(14,2);
  v_expected numeric(14,2);
  v_purchase_journals integer;
  v_entry_id uuid;
  v_lines jsonb;
  v_corrected integer := 0;
  v_already_corrected integer := 0;
  v_review integer := 0;
  v_amount numeric(14,2) := 0;
BEGIN
  FOR v_purchase IN
    SELECT
      pu.id,
      pu.invoice_number,
      pu.branch_id,
      pu.supplier_id,
      pu.status,
      pu.total,
      pu.paid_amount,
      pu.created_at
    FROM public.purchases pu
    WHERE pu.payment_method = 'credit'
      AND pu.status IN ('completed','partial')
      AND COALESCE(pu.paid_amount,0) > 0
      AND (p_purchase_id IS NULL OR pu.id = p_purchase_id)
    ORDER BY pu.created_at, pu.id
    FOR UPDATE
  LOOP
    SELECT
      COALESCE(round(sum(
        CASE WHEN coa.code='1010' THEN jel.credit-jel.debit ELSE 0 END
      ),2),0),
      COUNT(DISTINCT je.id)
    INTO v_bank_net, v_purchase_journals
    FROM public.journal_entries je
    LEFT JOIN public.journal_entry_lines jel
      ON jel.journal_entry_id = je.id
    LEFT JOIN public.chart_of_accounts coa
      ON coa.id = jel.account_id
    WHERE je.reference_type='purchase'
      AND je.reference_id=v_purchase.id;

    IF EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.reference_type='purchase_payment_reconciliation'
        AND je.reference_id=v_purchase.id
    ) THEN
      UPDATE public.purchases
      SET paid_amount=0
      WHERE id=v_purchase.id
        AND payment_method='credit'
        AND COALESCE(paid_amount,0) <> 0;

      v_already_corrected := v_already_corrected + 1;
      CONTINUE;
    END IF;

    -- No direct bank effect means there is nothing safe to reverse from 1010.
    -- If there is no purchase journal at all, preserve the row for manual review.
    IF COALESCE(v_bank_net,0) <= 0 THEN
      IF COALESCE(v_purchase_journals,0)=0 THEN
        PERFORM public.log_audit_action(
          v_purchase.branch_id,
          'purchase_credit_reconciliation_review',
          'purchase',
          v_purchase.id,
          jsonb_build_object(
            'invoice_number', v_purchase.invoice_number,
            'reason', 'NO_DIRECT_PURCHASE_JOURNAL',
            'payment_method', 'credit',
            'paid_amount', v_purchase.paid_amount,
            'total', v_purchase.total
          )
        );
        v_review := v_review + 1;
      END IF;
      CONTINUE;
    END IF;

    IF v_purchase.supplier_id IS NULL THEN
      RAISE EXCEPTION
        'PURCHASE_CREDIT_RECONCILIATION_SUPPLIER_REQUIRED purchase=% invoice=%',
        v_purchase.id, v_purchase.invoice_number;
    END IF;

    v_expected := round(
      LEAST(
        GREATEST(COALESCE(v_purchase.paid_amount,0),0),
        GREATEST(COALESCE(v_purchase.total,0),0)
      ),
      2
    );

    IF abs(round(v_bank_net,2) - v_expected) > 0.01 THEN
      RAISE EXCEPTION
        'PURCHASE_CREDIT_RECONCILIATION_AMOUNT_MISMATCH purchase=% invoice=% bank=% expected=%',
        v_purchase.id, v_purchase.invoice_number, v_bank_net, v_expected;
    END IF;

    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_key','bank',
        'debit',v_bank_net,
        'credit',0,
        'note','Historical credit purchase bank correction ' || v_purchase.invoice_number
      ),
      jsonb_build_object(
        'account_key','ap',
        'debit',0,
        'credit',v_bank_net,
        'supplier_id',v_purchase.supplier_id,
        'note','Historical credit purchase AP recognition ' || v_purchase.invoice_number
      )
    );

    v_entry_id := public._post_journal_entry(
      v_purchase.branch_id,
      'purchase_payment_reconciliation',
      v_purchase.id,
      v_purchase.invoice_number,
      'تصحيح تاريخي: شراء آجل رُحّل خطأ على البنك ' || v_purchase.invoice_number,
      v_lines
    );

    -- Keep the financial period correct without pretending the correction itself
    -- was executed historically: entry_date follows the original purchase while
    -- created_at/audit timestamps remain the actual correction time.
    UPDATE public.journal_entries
    SET entry_date = v_purchase.created_at::date
    WHERE id = v_entry_id;

    UPDATE public.purchases
    SET paid_amount=0
    WHERE id=v_purchase.id
      AND payment_method='credit';

    PERFORM public.log_audit_action(
      v_purchase.branch_id,
      'purchase_credit_bank_reconciled',
      'purchase',
      v_purchase.id,
      jsonb_build_object(
        'invoice_number', v_purchase.invoice_number,
        'correction_entry_id', v_entry_id,
        'bank_debit', v_bank_net,
        'ap_credit', v_bank_net,
        'old_paid_amount', v_purchase.paid_amount,
        'new_paid_amount', 0,
        'original_purchase_date', v_purchase.created_at
      )
    );

    v_corrected := v_corrected + 1;
    v_amount := v_amount + v_bank_net;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'corrected', v_corrected,
    'already_corrected', v_already_corrected,
    'manual_review', v_review,
    'corrected_amount', round(v_amount,2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.reconcile_credit_purchase_bank_history(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reconcile_credit_purchase_bank_history(uuid)
  TO service_role, postgres;

COMMENT ON FUNCTION private.reconcile_credit_purchase_bank_history(uuid) IS
  'Idempotently reclassifies historical completed credit-purchase bank postings to AP without mutating original journal entries.';

-- Apply once to existing history. Fresh databases naturally no-op.
SELECT private.reconcile_credit_purchase_bank_history(NULL);

NOTIFY pgrst, 'reload schema';
COMMIT;
