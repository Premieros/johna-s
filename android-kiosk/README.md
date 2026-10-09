# Johnas POS — Lenovo Tab One dedicated tablet

Standalone Android wrapper for the already-deployed Johnas POS website. The web app, Supabase backend, and production database are unchanged. The Android application is **not a standalone offline POS**.

## Current state and important limitations

- **Source/builder only:** the GitHub Action produces a DEBUG test APK. The test artifact is **not** the permanent-signature production enrollment APK.
- **Debug preview mode:** if Device Owner has not been provisioned, the DEBUG build opens the Johnas website with a visible **device is not locked** banner; Home and Recents remain available. The RELEASE build instead refuses to show the POS until Device Owner is configured. Never treat preview as kiosk protection.
- Kiosk hard-lock needs Android **Device Owner** provisioning; merely installing an APK does not lock Android. A fresh tablet is recommended. **Do not reset a configured device without an explicit owner decision.**
- Default pinned site: `https://premieros.github.io/johna-s/`; verify that this is the real deployed production site on the tablet **before** provisioning.
- Only same-origin, same-base-path web navigation is permitted. Supabase API calls inside the web page are not navigation and can work normally.
- Initial administrator PIN is selected on the tablet (6–12 numbers), stored as a salted PBKDF2 hash; there is no default PIN. Long-press the on-screen Wi-Fi button to unlock using that PIN.
- The short-tap Wi-Fi button requests Android's `Settings.Panel.ACTION_WIFI`, **not** the full Settings app. On the actual Lenovo TB305FU Android 15, the user reported the panel is blocked while locked. **Staff Wi-Fi-only access is NOT solved/validated.** Never allowlist the whole Settings package as a workaround.
- Authorized manager fallback (versionCode 2): **long-press Wi-Fi**, enter manager PIN, then use the **manager maintenance** screen's Wi-Fi Settings button. The app suspends lock task first and deliberately **does not launch HOME** (which is Johnas and previously re-locked immediately). In this UNLOCKED manager mode, other Settings could be reached; it is strictly PIN-protected maintenance, **not** a Wi-Fi-only staff workflow. Always tap **Return to Johnas and re-lock** before handing the tablet to staff.
- Lock-task, HOME replacement and boot handling require testing on the exact Lenovo Tab One Android build. Automatic boot launch is primarily via persistent HOME; boot broadcast is a fallback.
- Printing, scanner/camera, file downloads (including blob Excel), permissions, login persistence and native back behaviour require hands-on QA before staff deployment. Android WebView is not automatically equivalent to Chrome.
- Server-side permissions / branch isolation still control POS business data. The staff may view material costs under the existing app roles; no extra financial data grant is added.
- Android system recovery methods, safe mode, factory reset, service access and physical troubleshooting cannot be mathematically prevented by an app.

## Build a test APK using GitHub Actions

The `Build Lenovo Tab One kiosk (test and unsigned release APKs)` workflow compiles `app-debug.apk` and `app-release-unsigned.apk` and runs unit tests, then attaches both results as GitHub Actions artifacts. This version uses an **ephemeral CI debug signing key**. DO NOT enroll it as permanent Device Owner: a later release with a different signature cannot update it in place.

Local Android Studio: open the `android-kiosk` directory and build the app using AGP 8.7.3, Gradle 8.9 and JDK 17; Android SDK 35. The repository does not bundle a Gradle wrapper binary.

## Production signing is a separate requirement

The user confirmed they created their own local PKCS12 keystore on Windows at `D:\\JohnasKioskKeys\\johnas-kiosk-release.p12` (do not upload it). **The new GitHub workflow also publishes an unsigned release APK**, under the artifact name `johnas-tab-one-UNSIGNED-RELEASE-LOCAL-SIGNING-REQUIRED`. It contains `app-release-unsigned.apk`. It **will not install** until the owner signs it.

To sign locally on Windows after downloading the unsigned APK, obtain `apksigner.bat` from the official Android SDK Build Tools (version 35.0.0 or newer) and run it on the machine that holds the keystore:

```powershell
& "C:\\Path\\To\\Android\\Sdk\\build-tools\\35.0.0\\apksigner.bat" sign --ks "D:\\JohnasKioskKeys\\johnas-kiosk-release.p12" --ks-type PKCS12 --ks-key-alias johnas-kiosk --out "D:\\platform-tools\\johnas-kiosk-release-signed.apk" "D:\\platform-tools\\app-release-unsigned.apk"
& "C:\\Path\\To\\Android\\Sdk\\build-tools\\35.0.0\\apksigner.bat" verify --verbose --print-certs "D:\\platform-tools\\johnas-kiosk-release-signed.apk"
```

Use interactive PIN/password prompts only; do not provide passwords on the command line, in a screenshot, in chat, or in GitHub secrets. Retain the same keystore and certificate for every app update and keep a secure **offline encrypted backup**.

The tablet currently runs the **CI-debug signed APK**. Before installing a production-signed APK, the incompatible debug build must be uninstalled (`adb uninstall com.johnas.kiosk`), which clears its app-local data. **Never run uninstall after Device Owner enrollment.** Only uninstall before provisioning, and only after the owner's acknowledgment. Installing the signed release before provisioning will show the Device Owner required message; that is correct and is not a crash.

Choose and securely back up a permanent **release** signing keystore before Device Owner provisioning. Never commit the keystore, passwords or base64 secret to GitHub. The Gradle build accepts these environment variables:

- `KIOSK_KEYSTORE_FILE`: absolute path to your release keystore
- `KIOSK_KEYSTORE_PASSWORD`
- `KIOSK_KEY_ALIAS`
- `KIOSK_KEY_PASSWORD`

Then run `gradle :app:assembleRelease` from `android-kiosk` with Gradle 8.9 and JDK 17. Keep the exact signing certificate for every upgrade. If signing is lost, Device Owner management/uninstall may require factory reset.

## Enroll a brand-new tablet — technician procedure (only after backup and release signing)

1. Confirm actual model/Android version and that no Google account or work profile is provisioned. Follow Lenovo/Android Enterprise documented fresh-device provisioning.
2. Install the **permanently signed** release APK using ADB on the clean tablet.
3. Depending on device firmware and user-setup state, test:
   `adb shell dpm set-device-owner com.johnas.kiosk/.KioskAdminReceiver`
   Android may reject this on an already provisioned device or firmware. Do not bypass enterprise restrictions; use supported Android Enterprise QR/MDM provisioning where applicable.
4. Verify `adb shell dumpsys device_policy` reports `com.johnas.kiosk` as Device Owner.
5. Launch Johnas POS, set and safely record the administrator PIN (6–12 digits).
6. Verify HOME / Recents / Back / notifications cannot leave the POS; restart and verify automatic launch.
7. Verify Wi-Fi selection works through the **Wi-Fi panel** while lock task is active and it does not open unrestricted Settings. If not, **do not deploy this build** until a compliant network-management path is verified.
8. Test an actual permitted **test transaction**, offline recovery, void/refund, checkout printing and Excel exports with the user's approval. No real purchases or production tests are part of this source build.

Observed target hardware: **Lenovo Tab One model TB305FU, Android 15**, connected successfully by ADB. This confirms the device identifier and developer transport only; it does NOT constitute a functional kiosk test.

The application enters lock task only when BOTH Device Owner is active and the admin PIN is configured. The tablet never unlocks for ordinary staff merely because Wi-Fi is changed. Authorized administrator exit clears persistent HOME and lock-task allowlisting for that session.

## Security limits

A Device Owner APK is sensitive infrastructure. All elevated operations are explicit. The Android wrapper does not change production accounting, stock, kitchen flows or Supabase policies.

## Upgrading the currently enrolled Device Owner kiosk (versionCode 2)

The user enrolled the **production-signed** build of `com.johnas.kiosk` on Lenovo TB305FU with their **local key**. A new release MUST be signed with the **same PKCS12 keystore and alias**, then installed using `adb install -r <signed APK>`. **Do not uninstall the enrolled Device Owner APK.** Keep USB connected during first trial, and verify signature locally with apksigner before installation. Initial release used versionCode 1; the manager Wi-Fi fix bumps it to versionCode 2.

After updating, long-press Wi-Fi and enter the PIN. A manager maintenance page should appear rather than jumping briefly to HOME and immediately returning to Johnas. Select manager Wi-Fi Settings; use Back to return to maintenance; explicitly press Return to Johnas/re-lock. Verify Home/Recents are blocked again. Staff short-tap Wi-Fi under lock task still may not work until a separate tested system-level Wi-Fi-only path is implemented. No factory reset is expected for same-certificate APK updates.
