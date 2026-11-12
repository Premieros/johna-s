-- Backdated physical count foundation only. No live balance or accounting mutation.
-- Do not enable backdated posting until historical replay and FIFO reconciliation
-- are implemented and tested in a separate, reviewed migration.
ALTER TABLE public.stock_counts
  ADD COLUMN IF NOT EXISTS counted_at timestamptz;

COMMENT ON COLUMN public.stock_counts.counted_at IS
  'Actual physical count cutoff timestamp; distinct from creation/submission/application. Null on legacy sessions. Not yet used for posting.';

-- Do not infer historical physical count time from created_at.
-- Avoid changing existing approved/applied counts or automatic timestamps.
