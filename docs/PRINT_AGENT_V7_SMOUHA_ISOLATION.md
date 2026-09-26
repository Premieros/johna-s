# Isolated Print Agent V7 build for Smouha

This branch packages the existing Print Agent V7 runtime without changing its runtime source.

Isolation guarantees:
- separate Windows app id: `com.premieros.printagent.v7.smouha`
- separate product/shortcut name: `Premier Print Agent V7 - Smouha`
- separate build output directory
- no database migration
- no printer routing change
- no cloud queue mutation
- no replacement or upgrade of the currently installed Premier Print Agent
- no change to `electron/main.cjs`, printer queue code, or current production print protocol

The Smouha copy must be signed in/configured with the Smouha branch account/routes after installation. The existing agent should remain installed and running unchanged.
