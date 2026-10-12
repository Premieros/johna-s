-- LOCAL CI ONLY: production-shaped estimated FIFO cost tables that are
-- missing from the current canonical migration replay.  This is an explicit
-- schema-drift diagnostic, NOT an authorized production migration.
-- Execute only inside the outer rollback-only disposable localhost fixture.
-- If a future canonical migration adds these, fail instead of masking drift.
DO $guard$
BEGIN
  IF to_regclass('public.raw_fifo_price_fallback_runs') IS NOT NULL
     OR to_regclass('public.raw_fifo_debt_price_estimates') IS NOT NULL THEN
    RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_PARITY_FIXTURE_ALREADY_PRESENT_RECONCILE_SCHEMA';
  END IF;
END $guard$;

CREATE TABLE public.raw_fifo_price_fallback_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('preparing','prepared','applying','applied','reversing','reversed','failed')),
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  reversed_at timestamptz,
  error_text text
);

CREATE TABLE public.raw_fifo_debt_price_estimates (
  debt_id uuid PRIMARY KEY REFERENCES public.raw_fifo_debts(id) ON DELETE CASCADE,
  source_ledger_id bigint NOT NULL UNIQUE REFERENCES public.inventory_ledger(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.raw_fifo_price_fallback_runs(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  estimated_unit_cost numeric(18,6) NOT NULL CHECK (estimated_unit_cost>0),
  original_estimated_quantity numeric(18,6) NOT NULL CHECK (original_estimated_quantity>0),
  remaining_estimated_quantity numeric(18,6) NOT NULL CHECK (remaining_estimated_quantity>=0),
  replaced_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (replaced_quantity>=0),
  zero_cost_finalized_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (zero_cost_finalized_quantity>=0),
  candidate_source text NOT NULL,
  candidate_event_id text NOT NULL,
  candidate_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_fifo_debt_price_estimates_quantity_limit
    CHECK (remaining_estimated_quantity + replaced_quantity + zero_cost_finalized_quantity
           <= original_estimated_quantity + 0.000001)
);
CREATE INDEX idx_raw_fifo_debt_price_estimates_run
  ON public.raw_fifo_debt_price_estimates(run_id,branch_id,raw_material_id);

ALTER TABLE public.raw_fifo_price_fallback_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_debt_price_estimates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raw_fifo_price_fallback_runs FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_fifo_debt_price_estimates FROM PUBLIC,anon,authenticated;
