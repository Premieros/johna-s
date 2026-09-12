-- Resolve ambiguous calls to the warehouse-aware raw FIFO helper.
--
-- The negative-inventory migration introduced the canonical 10-argument
-- overload with p_allow_negative DEFAULT false while the legacy 9-argument
-- warehouse-aware overload remained present. PostgreSQL therefore cannot
-- resolve calls that provide exactly 9 arguments, because both signatures are
-- candidates.
--
-- Keep the canonical 10-argument implementation and its default=false behavior;
-- remove only the obsolete 9-argument warehouse-aware implementation.
-- Existing 9-argument callers continue to resolve to the 10-argument function
-- through its default p_allow_negative=false value.

DROP FUNCTION IF EXISTS public._raw_remove_fifo(
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  text,
  uuid,
  text,
  uuid
);

-- Preserve the internal-only execution boundary on the canonical helper.
REVOKE ALL ON FUNCTION public._raw_remove_fifo(
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  text,
  uuid,
  text,
  uuid,
  boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._raw_remove_fifo(
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  text,
  uuid,
  text,
  uuid,
  boolean
) TO service_role, postgres;
