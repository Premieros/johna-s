# Lenovo Tab One kiosk — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/lenovo-tab-one-kiosk-20261009`
Current PR: #483
Last updated: 2026-10-09

## Work status
State: **BLOCKED** pending manager maintenance patch exact-head CI and on-device testing. User created a local PKCS12 signature, signed Release APK (APK signature v3 verified), installed the signed build and activated Device Owner after removing Android accounts. User authorized factory reset if required, but it was not needed.

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
- GitHub workflow builds a DEBUG test APK plus an **UNSIGNED release APK**. User reports local PKCS12 keystore was created successfully at a private Windows location. Production app still needs local signing, signature verification, and secure key backup before Device Owner enrollment.
- Navigation policy unit test exercises URL origin/path protection.
- GitHub build runner's deprecated `setup-android` step used a removed `tools` SDK package; revised to install `platform-tools` explicitly.
- User connected exact Lenovo Tab One **TB305FU** with ADB; device reports **Android 15**.
- After successful Android APK builds (run 37949973343) and full Verify main (run 37949974457), discovered that the initial debug APK only displayed a Device Owner provisioning warning and could not preview the website.
- Adjusted **DEBUG builds only** to show a clearly marked unlocked Johnas WebView preview; release builds still refuse app use until Device Owner onboarding. This is an integration/usability correction, not a relaxation of the production kiosk gate.


## Verification ledger
- Initial Android APK workflow failed during SDK bootstrap, before Kotlin compilation; SDK setup action replaced.
- PR Verify main initially failed because the worklog declared an earlier active branch. Correcting plan and this log.
- Android APK compilation and Kotlin navigation tests succeeded at pre-preview commit `52852b86`. The later preview commit `463801e7` completed Android build run 37954638486 and Verify main run 37954638472 successfully; latest unsigned-release workflow changes require new exact-head checks. Device Owner provisioning, Wi-Fi system panel, boot, printing, downloads and hands-on tablet tests have **not** passed or been claimed.
- User reports opening Johnas login and Wi-Fi panel on debug-preview hardware. This is NOT a strict lock-task / Wi-Fi escape-control test; it must be repeated under Device Owner on the exact Android 15 firmware.
- Local Java 17 `keytool` available; user verified keystore creation with PowerShell `Test-Path = True`. Private keystore file/password not uploaded or shared.
- Added unsigned release build and local `apksigner` instructions; never sign in GitHub CI with user's production keystore.
- Device Owner enrollment worked after removing device accounts; app launched, user selected manager PIN and observed locking. Under lock task, short-tap Wi-Fi panel did not open on TB305FU Android 15. Manager PIN exit briefly displayed HOME then relaunched Johnas: root cause is the HOME intent resolving to the Johnas HOME Activity.
- Fixed manager PIN exit to **stop Lock Task without launching HOME**, display a protected maintenance screen, open Android Wi-Fi Settings only on explicit manager action, and provide an explicit re-lock button. VersionCode bumped to 2 and added a regression contract test. The manager path temporarily unlocks Android; this does NOT fulfill staff-only Wi-Fi isolation.
- Same local-keystore signing is mandatory for update (`adb install -r`); do NOT uninstall the existing Device Owner.
- Production website/SQL untouched.

## Production gate
State: **BLOCKED**: require exact-head CI + locally signed v2 release APK + Lenovo Tab One manager maintenance and re-lock tests + strict Wi-Fi-only operator solution before asserting all original requirements satisfied. PR merge and production distribution still require explicit approval. Never enroll with ephemeral GitHub CI debug signing certificate.

## Mandatory update protocol
Reconcile latest `main` and PR head before merge; keep `docs/CURRENT_WORK_PLAN.md` and this mandatory log synchronized. No merge without successful verification and explicit permission. No production SQL changes.

## Next action
Check exact-head APK CI; provide the new unsigned RELEASE artifact to user, locally align/sign/verify with existing PKCS12 key, and update using `adb install -r` WITHOUT uninstall. Test PIN manager maintenance Wi-Fi and manual re-lock on the live Lenovo Tab One. Staff Wi-Fi-only networking remains a separate blocked acceptance gate; never whitelist all Settings while locked. Verify Wi-Fi panel cannot open arbitrary Settings before declaring the kiosk locked.
