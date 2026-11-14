# A1 canonical disk recovery and encrypted backup boundary

Johna’s only (Premieros/johna-s). No live database/branch operation occurs here.
The intended T.B.S branch remains inactive; other branches remain cloud-operated.
This is private runtime preparation, not an installer or finished local POS.

## Implemented components

- `operation-store.snapshot()` serializes behind the owner's queued operations,
  flushes the owned DB, fingerprints its canonical migration ledger, and obtains
  an engine-native gzip data-directory snapshot. It returns a private raw archive
  for the backup owner, not a browser/public export endpoint.
- `runtime/backup.mjs` encrypts an owned snapshot with AES-256-GCM and a fresh
  12-byte nonce. It requires an explicit 32-byte key and opaque key ID; there is
  no default/global key or password-derived fallback. Authenticated metadata pins
  branch, store/protocol version, engine package version, application migration
  fingerprint, creation time, archive length and SHA256.
- Restore validates format/bounds, authenticates/decrypts and checks compatibility
  BEFORE creating a destination. It only creates a NEW directory; any existing
  path, even empty, is rejected. It never overwrites the original DB or erases
  pending operations. After loading it also verifies internal branch/store identity
  and the restored migration-ledger fingerprint. A failed fresh candidate is left
  for diagnosis; it is not silently activated or used to reset the original DB.
- `runtime/schema-identity.mjs` fingerprints the ordered version/name/checksum
  ledger. This is provenance/compatibility checking, NOT a live DDL drift audit.
  Real releases still need semantic schema compatibility and integrity checks.

Only private storage APIs are implemented. No upload/download API, scheduling,
admin permissions UI, Windows key custody, rotation, key recovery or actual
production restore/cutover is implemented. Backup keys must be managed separately
from the archive in the eventual protected Windows credential/key store. The
live Node filesystem DB itself is NOT encrypted by this backup module; OS/disk
protection remains a deployment requirement. Header branch/version/key identifiers
are readable; only archive content is encrypted. The archive contains the WHOLE
owned local database, not a branch-filtered cloud export; enrollment/bootstrap
must ensure the local dataset is correctly scoped before real use.

## Tests and actual coverage

Two Node tests verify encrypted round trip, missing/wrong key, tampered header and
ciphertext, truncation, foreign branch, engine/schema mismatch and refusal to
restore into an existing directory without invoking the loader.

The canonical disk fixture uses ALL 558 original migrations, the existing CI-only
Auth/subscription/permission fixtures and synthetic RLS branch/catalog data. It:

1. Executes a real `process_sale_split_idempotent` via the private store (cash/card),
   producing one sale, two tender rows, one stock deduction and one pending outbox.
2. Takes and encrypts the full owned snapshot; the fixture keeps its key only in
   parent memory. It rejects a foreign branch and restores into a fresh disk DB.
   The pending operation survives, and retrying restore over that DB is refused.
3. Stops the original writer BEFORE the restored writer starts.
4. Executes a second real split payment on disk, then kills its Node process AFTER
   commit+sync. Reopening and retrying returns the same sale ID: two sales, four
   tenders, quantity 8.0000 and two pending outbox rows, with all 558 migrations.
5. Kills another worker AFTER the third RPC's business writes but BEFORE its outer
   transaction commits. Reopen retains the prior two sales/tenders/stock/outbox.
6. Retries that third operation successfully: three sales, six tenders, quantity
   7.0000 and three pending outbox rows. No cloud ACK was fabricated or delivered.

The canonical fixture passed locally on Linux/Node 24. Dedicated Node 22 CI jobs
exercise it on BOTH Ubuntu and native Windows; exact-head CI is pending when this
record is committed. Only JSON test results are uploaded, not database archives,
keys, synthetic context files or backup bytes. Both private fixture databases and
keys are disposable; no real T.B.S/customer data is loaded or exported.

This verifies selected split-sale/stock/outbox recovery under process termination.
It is NOT a physical power-failure/storage-controller guarantee, a Windows service
installation test, a real Auth/offline-license proof, backup rollback of later
unsent operations, or proof for every other financial/kitchen/print workflow.
Old backups may omit later operations: activation requires fencing the original
writer and explicitly reconciling newer pending work, never silently replacing it.

## Remaining delivery gates

Single-writer service/lock, real local identity/permission/license leases,
branch-scoped bootstrap, full locally served POS/LAN/KDS, exclusive print ownership,
real cloud transport/receipts/config versions, signed code/schema releases and
Windows installer/repair/key custody are still open. Keep existing cloud clients
and agents unchanged. Do not sell on T.B.S using the experimental packages.
