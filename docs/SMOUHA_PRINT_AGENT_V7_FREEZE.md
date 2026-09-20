# Smouha v7 print-agent freeze

This document freezes the Windows headless print agent dedicated to **فرع نادي سموحة**.

- Branch ID: `19c3fd23-d784-455b-8840-f4f2ac619651`
- Production project: `azzdesuowpdcoflmyezn`
- Agent: `PremierSmouhaPrintAgentV07.exe`
- Package: `Smouha-Headless-Print-Agent-v7-Windows-x64.zip`
- Package SHA-256: `991bf2890f3000ca3d4a904f361d2a01cccc11a55838ddafbbfb16a3f3f36142`
- EXE SHA-256: `0e01930aa63ba97649245928bb82d90e25312772c5140ce0aaea327cd765464d`

## Freeze rule

The Smouha v7 executable is operationally independent from the Cleopatra v7 executable and is branch-scoped to Smouha.

Do **not** alter the behavior or signatures of these RPCs without explicit approval for a Smouha v7 migration/replacement rollout:

- `claim_cloud_print_jobs(uuid, uuid, integer)`
- `start_cloud_print_job(uuid, uuid)`
- `complete_cloud_print_job(uuid, uuid, boolean, text)`
- `can_execute_cloud_print_kind(text)`

The integration guard combines two protections:

1. A normalized structural fingerprint, which ignores PostgreSQL formatting/casing differences outside the observable contract.
2. Exact case-sensitive checks for the error/status/permission literals consumed by or observable to the frozen v7 agent.

The guard also freezes the required `cloud_print_jobs` column names, PostgreSQL data types, and nullability expected by v7.

Do not update the expected fingerprints, exact literals, or schema metadata merely to make CI green. A contract change requires an explicit Smouha v7 migration/replacement plan.

No production database migration is introduced by this freeze.
