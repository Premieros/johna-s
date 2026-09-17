# Print Queue Repair Log — 2026-09-17

## Scope

Repository: `Premieros/johna-s`

Branch: `development/print-queue-heartbeat-20260917`

Baseline: `main@fe57ca9e404bd36159b5c1705f5f46aa94e45adb`

Goal: make every cloud print command remain in a branch/station queue until the installed Windows/Electron print program claims it, without requiring the currently signed-in cashier to own `settings.manage`.

## Fixed design

1. Printer management remains protected by `settings.manage`.
2. A physical print device is registered to one allowed branch by a settings manager once.
3. Runtime execution uses the registered `agent_id` + branch binding and heartbeat; it no longer depends on `settings.manage` for the current POS user.
4. `claim/start/complete` remain branch scoped and require a registered enabled device.
5. Receipt authorization/reprint approval semantics remain unchanged.
6. Ambiguous Windows print outcomes remain terminal (`PRINT_OUTCOME_UNKNOWN`) instead of being blindly retried.
7. Print queue status is visible only to `settings.manage`, grouped by station, with online agent state and pending/claimed/printing/failed jobs.
8. No migration is applied to Production by this branch. Production migration requires Full Verify Green and explicit approval.

## Files

- `supabase/migrations/20260917205000_cloud_print_agent_registration_and_queue.sql`
- `src/features/pos/services/cloudPrint.ts`
- `src/features/pos/components/settings/CloudPrintAgent.tsx`
- `src/features/pos/components/settings/PrintQueueMonitor.tsx`
- `src/features/pos/components/settings/PrinterSettingsLauncher.tsx`
- `tests/unit/cloudPrintRegisteredAgentQueueContract.test.ts`

## Acceptance checks

- Manager enables cloud printing and binds the installed device to an allowed branch.
- The device registers and heartbeats.
- Sign in as a cashier/user without `settings.manage` but with branch access: registered Electron device continues polling and printing.
- Kitchen jobs are queued per `station_code`; missing physical route fails visibly instead of silently rerouting.
- Browser/mobile receipt jobs remain queued for station `cashier` and are printed by the installed program.
- Settings printer modal shows queue status grouped by station and indicates whether a print agent is online.
- Offline device leaves jobs pending; reconnecting device claims them in order.
- Fresh DB + schema + unit/integration/security verification must be green before merge.
