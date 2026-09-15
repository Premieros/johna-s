# Johna S Mobile

Android-first customer/captain delivery application. This workspace is intentionally isolated from the existing Vite POS frontend.

## Run locally

```bash
cd mobile
npm install
npm run android
```

SDK baseline: Expo 57 / React Native 0.86 / React 19.2.3.

## Current state

The first slice contains the native application shell, separate Customer and Captain entry experiences, and TypeScript gateway contracts. It does not write to Production and does not contain privileged Supabase credentials.

## Non-negotiable integration rules

- Reuse the existing order domain; do not create a parallel POS engine.
- Preserve branch isolation and RLS.
- Super Admin is the only implicit bypass; captain access is Permission-First.
- Keep `send_to_kitchen` as inventory authority.
- Do not change printer routing/queues/settings from the mobile project.
- Never ship a `service_role` key in the Android app.
