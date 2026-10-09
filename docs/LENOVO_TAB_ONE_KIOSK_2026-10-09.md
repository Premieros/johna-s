# Lenovo Tab One kiosk — preparation

User selected Lenovo Tab One and confirmed the tablet is new. Prepare, do not auto-enroll or reset.

Scope: dedicated Android WebView launcher + Device Owner component, boot/HOME start, lock task, Wi-Fi panel (not unrestricted Android Settings), manager PIN, GitHub Actions DEBUG APK artifact, and navigation regression tests.

Safety / acceptance:
- No production POS, Supabase, website or print-agent modifications.
- No device owner enrollment from afar; technician performs supported provisioning with a **permanent-signature** release APK.
- Android-specific compatibility is **unverified** until built on CI and tested on the actual Lenovo Tab One.
- Wi-Fi panel in lock task is firmware-dependent. Strict no-settings whitelist until validated.
- WebView print, barcode/camera, Android downloads/Excel and login persistence remain acceptance tests.
- A debug APK artifact may be used for visual tests but NOT permanent owner enrollment.
- Obtain owner's explicit approval before factory reset or business-live trial.

Delivery gate: separate PR, exact-head Android CI success, real device acceptance, then request merge/production distribution approval. No merge or deployment in this preparation.
