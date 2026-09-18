# Financial Day + Split Tender + Cashier Z-Report — 2026-09-18

## Scope
- Base: `main@8ad64ad518dd07f8a148cf95014463825beb1373`
- Branch: `development/financial-day-split-zreport-cashier`

## Financial-day rule
For `shift_span` mode, `business_day_start` is the cutoff, not the report start itself.

Example with 09:00 cutoff:
- nominal business date 2026-09-18 runs from 09:00 on Sep 18 to before 09:00 on Sep 19 for shift assignment;
- actual accounting begins at the first shift opened in that nominal window;
- actual accounting ends when the final shift assigned to that nominal day closes;
- a shift closing at 04:00 on Sep 19 still belongs to Sep 18 if it opened before the next 09:00 cutoff;
- purchases and expenses before the first actual shift are excluded from that day's report.

## Tender truth
- `sale_payments` is authoritative whenever tender-detail rows exist.
- Header `sales.payment_method/paid_amount` is used only as legacy fallback.
- Split invoices show each tender amount separately in Z-Report and day report.
- Cash calculation uses the actual cash tender allocation only.

## Z-Report printing
- Thermal Z-Report no longer depends on a browser popup.
- It is enqueued as `cloud_print_jobs.kind='report'`.
- Destination is always `station_code='cashier'`.
- The existing local/cloud print agent resolves the cashier station to the configured cashier printer.
- A4 remains an administrative browser preview.
- Report printing never replays sales, payments, orders, or inventory mutations.

## Safety
- Permission-First: report enqueue requires branch access and `shifts.report.shift` (Super Admin implicit bypass preserved).
- No RLS weakening.
- No Production migration has been applied for this branch.
