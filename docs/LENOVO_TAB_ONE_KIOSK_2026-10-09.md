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

## Lenovo Tab One V2 real-device acceptance — user-reported 2026-10-09
- Exact pre-documentation Android APK build run `37963931099` and Verify main run `37963931334` succeeded at commit `201bd790`. Documentation-only commits require fresh exact-head CI before merge.
- User aligned and locally signed V2 with the SAME permanent PKCS12 certificate (v3 signature verified, SHA-256 `dbbda122bb839b5c6494fdc5fdb984aaf175d8579fb4e7f402bc49e324d16496` matched the original). Initial wrong keystore password was corrected locally; no secrets were shared.
- User reported V2 working on the enrolled Lenovo Tab One: manager long-press/PIN opened maintenance, Wi-Fi Settings worked, and manager returned to Johnas and re-locked.
- User then ran `adb reboot` and explicitly confirmed Johnas opened automatically after device restart. This validates AUTO-LAUNCH after reboot on their hardware. It does **not**, by itself, separately prove Home/Recents cannot escape after reboot; ask for that final lockdown test if required.
- Ordinary employee short-tap Wi-Fi inside Lock Task remained blocked by Android 15 on this device; **operator Wi-Fi-only access without manager PIN is unresolved**. Manager maintenance temporarily lifts Lock Task and must not be represented as a restricted employee Wi-Fi panel.

## Production gate
State: **BASIC DEVICE OWNER KIOSK SMOKE TEST PASSED; STAFF WI-FI-ONLY REQUIREMENT OPEN.** User confirmed V2 manager Wi-Fi maintenance/re-lock and auto-start on reboot. Confirm post-reboot Home/Recents lock separately and implement/test restricted staff Wi-Fi if still required. PR merge and production distribution still require exact-head CI and explicit approval. Never enroll with ephemeral GitHub CI debug signing certificate.

## Mandatory update protocol
Reconcile latest `main` and PR head before merge; keep `docs/CURRENT_WORK_PLAN.md` and this mandatory log synchronized. No merge without successful verification and explicit permission. No production SQL changes.

## Next action
User should verify Home/Recents cannot escape the app **after reboot**. Keep secure encrypted/off-device backup of signing PKCS12 key and password. If original scope still requires ordinary staff changing Wi-Fi without manager PIN, design and test a restricted Android 15-safe network workflow (do not allowlist unrestricted Settings). Keep PR #483 draft until exact-head CI and explicit merge approval. No factory reset/uninstall of Device Owner app.
