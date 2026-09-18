# Business Day Boundaries & Strict Shift Close — 2026-09-18

## Base
- Repository: `Premieros/johna-s`
- Base: `main@eeb4ec7e63eabda699ec71c2c065de132cf6634f`
- Branch: `development/business-day-boundaries-and-single-shift`

## Financial day modes
Per branch:
- `fixed_time`: configured local start/end times.
- `shift_span`: first shift opened on the business date through the last shift close.

The resolved report stores and prints:
- `window_start`
- `window_end`
- the boundary mode.

## Single open shift
The existing database invariant remains authoritative:
- one open shared shift per branch;
- deferred unique constraint on `(branch_id, open_branch_guard)`;
- advisory lock in `open_shift`.

The UI no longer offers opening another branch shift while one is already open.

## Strict close rule
A shift cannot close while any operational order remains `open` or `held`.
There is no UI override to close the shift with open orders.
The legacy `close_shift_with_open_orders` RPC remains only as a fail-closed compatibility surface and returns `OPEN_ORDERS_BLOCK_SHIFT_CLOSE`.

The user must resolve all open/held orders first, then retry shift close.

## Auto-close at business-day end
Per branch setting:
- `auto_close_shift_at_day_end=false` => leave the shift open.
- `true` => the app periodically calls the server auto-close RPC while the system is running.

The server auto-close RPC:
- applies only to `fixed_time` mode;
- waits until the configured day-end boundary;
- refuses to close if any open/held order remains;
- never closes or cancels orders itself;
- never assumes physical cash count;
- stores `expected_amount` only and leaves `actual_amount` / `difference` NULL;
- records `AUTO_CLOSED_AT_BUSINESS_DAY_END` and audit data.

## Safety
- No role-name authorization added.
- No RLS weakening.
- No order cancellation bypass.
- No sent-item void bypass.
- No inventory mutation added.
- No Production migration applied by this branch yet.
