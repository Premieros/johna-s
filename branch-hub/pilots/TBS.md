# T.B.S — first intended local-only operating branch

Verified 2026-11-14 in the Johna’s application and its own Supabase project.
This is a preparation record, NOT a deployment/enrollment credential or runtime
configuration. These identifiers must never select another branch by fallback.

| Item | Verified value |
| --- | --- |
| Repository | Premieros/johna-s |
| Supabase project | azzdesuowpdcoflmyezn (john's, eu-west-1) |
| Organization | 016dec87-e4de-4153-97fa-986738b191a5 |
| Branch name / English name | T.B.S |
| Branch ID | 0a54e71b-5ac1-42ec-a620-f0296637e79c |
| Main warehouse | T.B.S - Main |
| Warehouse ID | 274fbaaa-efcc-48da-850c-d1f6d0255f2d |
| Branch status after preparation | is_active=false |
| Branch settings | inherited canonical defaults: currency L.E, tax disabled, rate 0 |
| Subscription | canonical creation produced trial; no paid plan/upgrade was purchased |

The owner explicitly requested adding T.B.S inside Johna’s and making it the
first branch to operate locally only. The branch was created via the existing
Branches UI under the owner's authenticated session, using the canonical
create_organization_branch path. Warehouse, settings and trial were seeded by
that existing path. No Auth claims were forged or database guards disabled.

The create form's inactive selection was ignored by the existing creation path,
which always creates active branches. The new T.B.S row was immediately edited
through the normal update UI and verified as inactive. This existing create-form
behavior is recorded, not repaired as an unrelated deployment in this task.

Smouha and Cleopatra remain active and retain their current cloud routes. The
active branch in the owner's browser was not switched. No POS order, payment,
print, user credential, stock transfer or historical record was changed by this
bootstrap. No cloud schema migration or print-agent replacement was performed.

Inactive is NOT an implemented local-only transaction policy. No deployment mode
field/enrollment, authenticated local API, shared LAN POS, real cloud synchronization
or complete Windows installer is ready yet. Do not mark T.B.S as locally running
or start sales using the experimental packages. The first real local installation
must bind to these exact branch/warehouse IDs, enroll scoped users/devices, rehearse
backup/recovery and validate operating/permission/print ownership before activation.

The existing cloud clients of all other branches must remain unchanged throughout
that preparation. Do not reactivate or cut over T.B.S just because files download.
