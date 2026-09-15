# Johna S Waiter Android

Android-first dining-room waiter application, isolated under `mobile/` from the existing Vite POS frontend.

## Purpose

The app is for the hall waiter/captain. It uses the same authenticated users, branch access, RLS and Permission-First capabilities already defined by Johna S. A manager can sign in from the same Android app and sees only the mobile capabilities granted by the existing permission model.

## Live workflow

- Sign in with the existing Johna S username/PIN.
- Load only RLS-visible branches.
- Select dining area/table and show the responsible waiter on occupied tables.
- Load the live branch catalog and categories.
- Load canonical product modifier groups via `get_product_modifiers`.
- Create dine-in orders through canonical `create_order`.
- Reopen/edit active orders through canonical `update_order`.
- Send the current delta through canonical `send_to_kitchen`.
- View the signed-in user's orders and current Kitchen status.
- Show allowed/denied mobile capabilities from the current system permissions.

## Security and scope

- No `service_role` key is shipped in the Android app.
- The Android client uses only the public Supabase anon key plus the signed-in user's session.
- RLS, branch isolation and server permission checks remain authoritative.
- No Android-specific database migration or backend fork is introduced.
- No direct inventory writes are performed from the app.
- Printing is intentionally untouched/frozen.
- Customer/delivery-driver mode is deferred.
- Payment/split/transfer permissions are visible when granted, but the current waiter MVP does not execute those financial/manager actions from Android yet; they remain in the existing POS until wired to their canonical server contracts in a separate verified slice.

## Run locally

```bash
cd mobile
npm install
npm run android
```

Required public client configuration:

```text
EXPO_PUBLIC_SUPABASE_URL=https://azzdesuowpdcoflmyezn.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<public anon key>
```

GitHub Actions injects the repository public anon-key secret into the APK build. SDK baseline: Expo 57 / React Native 0.86 / React 19.2.3.

## Release gate

The APK is accepted only after `TypeScript -> Expo Android prebuild -> Gradle release -> artifact upload` are all green on the current mobile head. No merge to `main` is implied by a successful APK build.
