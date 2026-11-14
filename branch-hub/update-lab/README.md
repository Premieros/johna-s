# Personal-PC browser update experiment

Extract this complete folder and run `Start-Update-Lab.cmd` with Docker Desktop
in Linux container mode. Open http://127.0.0.1:58110 and keep the console open.
The Node 22 image is reused from the previous trial, or downloaded if missing.
No npm install, Supabase connection, GitHub credentials or printer is used.
Only port 58110 is published, on loopback. This trial is NOT for branch/LAN access.
Do not change firewall rules or stop the existing Supabase containers.

The Arabic browser page has a fake order draft, fake 3-second payment and local
publisher controls. Publish a new release and see its new screen appear without
reloading or losing the draft. Disconnect only the simulated update feed, publish,
then reconnect. Try a corrupt package: the active version must remain unchanged.
A release stages during a fake payment and activates after the payment finishes.

Signed Ed25519 manifests pin sequence, payload size/hash and data schema. This
experiment changes presentation DATA, not downloaded JavaScript or SQL. It is
not the original POS, a verified application installer, cloud feed, production
signing/enrollment system, browser offline assets solution, or financial database.
No claim is made that arbitrary POS code/schema can activate safely this way.
An actual code update needs versioned assets, compatible APIs, recovery and real
transaction/draft lifecycle barriers. Data-schema migrations remain unimplemented.

`.update-lab-state` stores the local draft, active presentation version and LAB
signing keys. Never reuse those keys for production. Drafts also have a browser
localStorage recovery copy. Node atomic file replacement is used; sudden power
loss/disk failure guarantees are not established. Restart the CMD to check normal
restart persistence. Closing it stops the server. Existing databases are untouched.

Only localhost is supported. Do not enter real customer data or credentials.
The feed is generated on the same computer: it simulates reconnection, not a real
GitHub release. The browser polls local state every 500 ms; the server checks the
signed local feed every 2 seconds. Production distribution remains future work.
