-- Per-branch sales invoice prefix.
-- Applies only to newly allocated online sales. Existing sales remain unchanged.
-- Empty/NULL means "preserve the existing server-generated numbering".

ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS invoice_prefix text;

ALTER TABLE public.branch_settings
  DROP CONSTRAINT IF EXISTS branch_settings_invoice_prefix_format;

ALTER TABLE public.branch_settings
  ADD CONSTRAINT branch_settings_invoice_prefix_format
  CHECK (
    invoice_prefix IS NULL
    OR (
      invoice_prefix = btrim(invoice_prefix)
      AND char_length(invoice_prefix) BETWEEN 1 AND 12
      AND invoice_prefix !~ E'[\\r\\n\\t]'
    )
  );

COMMENT ON COLUMN public.branch_settings.invoice_prefix IS
  'Optional per-branch prefix for newly allocated sales invoice numbers, e.g. #S -> #S12. NULL preserves legacy numbering.';
