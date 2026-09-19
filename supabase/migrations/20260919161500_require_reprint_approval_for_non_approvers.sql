-- Require manager approval for receipt reprints by non-approver roles.
-- Existing authorize_sale_print / record_sale_print already return
-- MANAGER_APPROVAL_REQUIRED when pos.reprint is absent.
-- This migration only removes the direct-reprint bypass from roles that
-- cannot review approvals themselves. It does not change printers, routing,
-- queues, agents, first-print permission, or receipt payloads.

UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb) - 'pos.reprint',
    updated_at = now()
WHERE
  CASE jsonb_typeof(COALESCE(permissions, '[]'::jsonb))
    WHEN 'array' THEN COALESCE(permissions, '[]'::jsonb) ? 'pos.reprint'
    WHEN 'object' THEN COALESCE((permissions ->> 'pos.reprint')::boolean, false)
    ELSE false
  END
  AND NOT (
    CASE jsonb_typeof(COALESCE(permissions, '[]'::jsonb))
      WHEN 'array' THEN COALESCE(permissions, '[]'::jsonb) ? 'approvals.review'
      WHEN 'object' THEN COALESCE((permissions ->> 'approvals.review')::boolean, false)
      ELSE false
    END
  );
