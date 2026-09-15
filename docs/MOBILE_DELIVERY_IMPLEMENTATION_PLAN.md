# Mobile Waiter Implementation Plan

Status: Android waiter workstream on PR #132.

## Approved product direction

`Captain` means dining-room waiter. Delivery-driver maps/routes and customer mode are not part of this slice.

The Android app is a mobile client of the existing Johna S POS domain, not a second POS engine. Existing authenticated users sign in, and the UI is capability-driven from the current Permission-First model.

## Implemented Android slice

- Existing username/PIN authentication.
- RLS-visible branch selection.
- Dining area/table browsing.
- Occupied-table responsible waiter display.
- Live products/categories and image fallback.
- Canonical modifier groups and price deltas.
- New dine-in order via `create_order`.
- Active order edit/delta via `update_order`.
- Kitchen submission via `send_to_kitchen`.
- My Orders and Kitchen/status visibility.
- Permission screen for supported mobile capabilities.
- Persisted Supabase Auth session using the public anon key only.

## Binding safety rules

- No `service_role` in Android.
- No mobile-specific Production migration.
- No direct inventory mutation from Android.
- No printer/Print Agent changes.
- No role-name authorization; Super Admin only implicit bypass.
- Server/RLS checks remain authoritative even when buttons are hidden by the UI.
- Customer application remains deferred.

## Later slices, not claimed complete here

Financial payment, split bill, order transfer/merge and approval-center execution must reuse their exact canonical server contracts and receive separate regression verification. Their granted permissions can be displayed in the app, but this waiter MVP does not execute those operations yet.

## Gate

`TypeScript -> Android prebuild -> Release APK -> artifact upload -> targeted live acceptance with a test waiter account`.

No merge to `main` without explicit approval.
