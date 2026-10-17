# Live support — staged implementation

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feature/live-support-consent-20261017`
Current PR: #523
Last updated: 2026-10-17 Africa/Cairo
State: **BLOCKED**

## Guardrails
User authorized implementation, not production release. No production DB writes, production migration apply, live screen capture, print tests, or deployment. Support flag defaults OFF. Do not modify operational POS, kitchen, printing, accounting or stock behavior. No recording, microphone, camera, service key, OS control, or arbitrary JavaScript execution.

## Baseline
`6d9cf06bbd2572a525e2b4419bdf971437265c1b` (PR #522 deployed). Separate clean worktree, one active development branch.

## Root-cause ledger
New capability: support currently cannot join a consented employee tab. Web screen sharing alone is not remote input. Implement browser-native tab capture plus authenticated private WebRTC signaling and a narrow command protocol. Chrome/Edge Capture Handle verifies the employee selected the exact current tab, not a monitor or another page. Unsupported browsers fail closed.

## Change ledger
- Floating support launcher; Ctrl five times in 2.5 seconds opens the request UI only, never starts capture or grants control.
- Lazy loading of support UI, no support network reads/timers/listeners when disabled (except render-time flag check).
- Manager tab in general manager console, explicit `support.manage` capability. Manual request refresh, branch scope enforced by server.
- Twenty-minute sessions, immutable ownership, atomic single-manager claim, separate view and navigation/scroll consent, local immediate stop/revoke, DB audit attribution and expiration. Polling only for a pending/active session, no global realtime subscription.
- Screen video goes peer-to-peer or through an explicitly provisioned TURN relay; no frames stored in the DB. SDP/ICE metadata lives in a separate RLS table.
- CONTROL LIMIT: first version supports actual in-app navigation to allowlisted read-oriented pages and viewport scrolling. It does NOT support arbitrary clicks, product edits, typing, POS, financial actions, KDS status changes, print/reprint, shift closing, file downloads, or OS input. Full unrestricted remote control is intentionally not claimed.
- Sharing stops when leaving allowlisted routes, on password/private fields, identity/branch change, transport/poll failure, expiry, or employee stop. The employee must close other sensitive information before capture; generic pixel-perfect redaction is not implemented.
- Staged schema in supabase/migrations/20261017121208_live_support_consent_staged.sql; generated with Supabase CLI and only applied to fresh CI. Never applied to production. Uses SECURITY INVOKER with RLS and existing branch/permission authority. Append-only audit, no new definer bypass.

## Verification ledger
Local app/test typecheck, production build and lint passed (13 existing warnings, no errors); 22 protocol/worklog tests and 19 protocol/disabled-launcher tests passed. Exact-head CI, fresh DB integration/RLS, feature-enabled browser and two-device acceptance remain pending. Tests must cover authorized claim/consent, unauthorized branch/user denial, sender spoofing, expiry/end, blocked commands and inactive launcher's zero side effects.

## Production gate
No Merge ولا Production migration before explicit owner approval and complete verification.
Before enabling: apply the separately reviewed staged migration; deploy with flag OFF, confirm RLS and schema parity; configure STUN/TURN with expiring credentials (never commit permanent TURN credentials), test two physical devices across branch networks, capture end/permission revoked/timeout and mobile fallback. Without ICE services cross-network connectivity is not guaranteed. This remains disabled and is not production ready.
Signaling contains private network metadata: define short retention and an approved scheduled cleanup before activation. No retention automation is installed in production.

## Next action
Run full CI on draft PR, address failures, then demonstrate two-device flow before proposing release. Full typing/click control needs a separate audited action registry and explicit scope; never relax the safe command parser.

## Mandatory update protocol
Update evidence and blockers on each meaningful change. Keep this log as the active work reference. Rollback UI by disabling VITE_LIVE_SUPPORT_ENABLED; stop sessions locally first. Staged SQL has not been applied to production, so no production DB rollback is needed.
