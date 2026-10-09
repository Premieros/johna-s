# Johnas POS — Lenovo Tab One dedicated tablet

Standalone Android wrapper for the already-deployed Johnas POS website. The web app, Supabase backend, and production database are unchanged. The Android application is **not a standalone offline POS**.

## Current state and important limitations

- **Source/builder only:** the GitHub Action produces a DEBUG test APK. The test artifact is **not** the permanent-signature production enrollment APK.
- Kiosk hard-lock needs Android **Device Owner** provisioning; merely installing an APK does not lock Android. A fresh tablet is recommended. **Do not reset a configured device without an explicit owner decision.**
- Default pinned site: `https://premieros.github.io/johna-s/`; verify that this is the real deployed production site on the tablet **before** provisioning.
- Only same-origin, same-base-path web navigation is permitted. Supabase API calls inside the web page are not navigation and can work normally.
- Initial administrator PIN is selected on the tablet (6–12 numbers), stored as a salted PBKDF2 hash; there is no default PIN. Long-press the on-screen Wi-Fi button to unlock using that PIN.
- The Wi-Fi button requests Android's `Settings.Panel.ACTION_WIFI`, **not** the full Settings app. Under some Lenovo firmware/device-owner lock-task policies, Android may block this system panel. **Do not claim Wi-Fi-only escape works until checked on the actual Tab One.** Never allowlist the whole Settings package as a workaround.
- Lock-task, HOME replacement and boot handling require testing on the exact Lenovo Tab One Android build. Automatic boot launch is primarily via persistent HOME; boot broadcast is a fallback.
- Printing, scanner/camera, file downloads (including blob Excel), permissions, login persistence and native back behaviour require hands-on QA before staff deployment. Android WebView is not automatically equivalent to Chrome.
- Server-side permissions / branch isolation still control POS business data. The staff may view material costs under the existing app roles; no extra financial data grant is added.
- Android system recovery methods, safe mode, factory reset, service access and physical troubleshooting cannot be mathematically prevented by an app.

## Build a test APK using GitHub Actions

The `Build Lenovo Tab One kiosk (test APK)` workflow compiles `app-debug.apk` and runs unit tests, then attaches the result as a GitHub Actions artifact. This version uses an **ephemeral CI debug signing key**. DO NOT enroll it as permanent Device Owner: a later release with a different signature cannot update it in place.

Local Android Studio: open the `android-kiosk` directory and build the app using AGP 8.7.3, Gradle 8.9 and JDK 17; Android SDK 35. The repository does not bundle a Gradle wrapper binary.

## Production signing is a separate requirement

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

The application enters lock task only when BOTH Device Owner is active and the admin PIN is configured. The tablet never unlocks for ordinary staff merely because Wi-Fi is changed. Authorized administrator exit clears persistent HOME and lock-task allowlisting for that session.

## Security limits

A Device Owner APK is sensitive infrastructure. All elevated operations are explicit. The Android wrapper does not change production accounting, stock, kitchen flows or Supabase policies.
