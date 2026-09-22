# Smouha Form Print Agent V8 — isolated alternative

This is a **new application identity**. It does not replace or modify the frozen
Smouha V7 executable.

## Goals

1. Print the structured fixed thermal **form** already present in
   `cloud_print_jobs.payload.template` instead of ignoring it and rasterizing
   only the small free-form `text`.
2. Reduce the idle query storm caused by V7 polling
   `claim_cloud_print_jobs` every 700ms.
3. Avoid duplicate physical prints when Windows accepted the print but the
   network failed before the completion callback.

## Isolation

- App identity: `PremierSmouhaFormPrintAgentV08`
- Separate config folder and Windows auto-start key.
- Separate single-instance mutex.
- Queue consumption is **OFF by default**.
- V7 RPC names/signatures are reused without changes.
- V7 executable/config/lock are not modified.
- The optional Realtime SQL is stored under `print-agent-v8/sql`, not under
  `supabase/migrations`; it is not automatically applied.

## Printing

Current POS/cloud jobs already contain a structured `template` for customer
receipts and kitchen tickets. V8 reads that object and draws a fixed GDI form
directly to a monochrome ESC/POS raster:

- large JOHNA'S header;
- clear document title;
- branch/station card;
- order / invoice / table / user metadata;
- fixed item columns for customer receipts;
- large quantity badge for kitchen;
- modifiers and notes preserved;
- totals in dedicated fixed rows with an enlarged grand total;
- Arabic RTL handling;
- RAW ESC/POS raster + cut.

If a legacy job has no template, V8 falls back to enlarged text raster output.

## Query budget

V7 idle behavior:

- one claim every 700ms;
- about **123,429 claim RPCs/day/device** even when nothing is printing.

V8:

- startup/reconnect claim;
- immediate claim on Realtime wake;
- drains a batch of up to 25 jobs;
- when Realtime is healthy: safety reconciliation every 5 minutes
  (about **288 idle claim RPCs/day/device**, roughly **99.8% lower** than V7);
- when Realtime is unavailable: fallback claim every 15 seconds
  (about **5,760/day**, roughly **95.3% lower** than V7);
- after a known print failure, one local retry wake after 35 seconds instead of
  returning to aggressive polling.

Realtime requires the optional wake-state SQL. Without it, V8 remains functional
through the 15-second fallback.

## Duplicate-print guard

Immediately after Windows accepts the RAW spool job, V8 records the cloud job ID
in a local seven-day journal **before** calling the remote completion RPC.

If the network fails after physical submission, a future reclaim of the same job
skips physical printing and retries only the completion callback.

## Safe test / rollout

1. Build V8.
2. Keep **Production Queue disabled**.
3. Configure the same dedicated Smouha device account.
4. Select kitchen/bar/cash printers.
5. Print the local kitchen form and customer form tests.
6. Compare paper output with the approved fixed form.
7. Only after acceptance:
   - stop V7 on the Smouha PC;
   - optionally apply the Realtime wake SQL;
   - enable Production Queue in V8.
8. Never run V7 and V8 as active consumers for the same branch at the same time.

## Rollback

Disable Production Queue in V8 and restart the unchanged V7 executable. No queue
RPC migration is required to roll back.
