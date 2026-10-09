# Lenovo Tab One kiosk — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/lenovo-tab-one-kiosk-20261009`
Current PR: #483
Last updated: 2026-10-09

## Work status
State: **BLOCKED** pending exact-head Android CI success, durable APK signing key and on-device Lenovo Tab One acceptance tests. User confirmed this is a NEW tablet, not that a factory reset is authorized.

## Guardrails
- No changes to live Johnas website, Supabase schema/data, kitchen send, inventory or printing.
- No production or tablet enrollment / factory reset without explicit approval and a durable signing identity.
- Avoid giving full Android Settings access to operator.
- Admin PIN must be created on tablet; no shared default/admin bypass PIN.
- Existing data permissions are controlled by Johnas auth and branch RLS.

## Baseline
Johnas was a deployed Vite/React website plus Electron desktop package; repository contained no Android kiosk app or signed APK. The user requests tablet autostart and no escape except Wi-Fi settings.

## Root-cause ledger
An ordinary browser shortcut, PWA, or Android WebView without Device Owner does not prevent exiting with HOME/Recents/system UI. A local Device Owner DevicePolicyManager, dedicated launcher, and allowlisted lock task are necessary. OS Wi-Fi panel availability in strict kiosk is dependent on Lenovo firmware.

## Change ledger
- Added `android-kiosk/` native Kotlin Android application (minSdk 29, compileSdk 35) and Gradle modules.
- Android DeviceAdminReceiver / Device Owner preflight, immutable approved URL allowlist, immersive WebView, HOME preferred activity, lock-task policy, boot receiver fallback.
- Wi-Fi button opens Android `Settings.Panel.ACTION_WIFI`; long press requests manager PIN, PBKDF2 hash in app-private preferences; manager may unlock.
- GitHub workflow builds a **DEBUG TEST APK ONLY**; production installation needs a stable release keystore, stored outside repository.
- Navigation policy unit test exercises URL origin/path protection.
- GitHub build runner's deprecated `setup-android` step used a removed `tools` SDK package; revised to runner SDK tools.

## Verification ledger
- Initial Android APK workflow failed during SDK bootstrap, before Kotlin compilation; SDK setup action replaced.
- PR Verify main initially failed because the worklog declared an earlier active branch. Correcting plan and this log.
- Android APK compilation, Device Owner provisioning, Wi-Fi system panel, boot, printing, downloads and real device tests have **not** yet passed or been claimed.
- Production website/SQL untouched.

## Production gate
State: **BLOCKED**: require exact-head CI + Lenovo Tab One full device tests + permanent signing key + explicit distribution/merge approval. Never enroll with ephemeral GitHub CI debug signing certificate.

## Mandatory update protocol
Reconcile latest `main` and PR head before merge; keep `docs/CURRENT_WORK_PLAN.md` and this mandatory log synchronized. No merge without successful verification and explicit permission. No production SQL changes.

## Next action
Check exact-head APK CI; fix compile/test defects. Download test artifact for sandbox evaluation only, then prepare separately signed production APK and technician-guided supported Device Owner provisioning with owner's go-ahead. Verify Wi-Fi panel cannot open arbitrary Settings before declaring the kiosk locked.
