# Public organization signup
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/public-organization-signup-20261111`
Current PR: `623`
Last updated: 2026-11-11
State: **DEPLOYED**

## Work status
Owner explicitly selected public organization registration from login, rather than internal administration only. Implement safe onboarding through existing Supabase Auth email confirmation and an authenticated atomic own-organization bootstrap.

## Guardrails
Keep register_tenant/register_branch/create_user privileged endpoints closed to anonymous callers. Never accept caller-selected user/role/organization/branch IDs in onboarding. Existing accounts cannot be re-provisioned or elevated. No customer stock, sale, print, journal or existing branch changes. Public signup remains independent of staff-account creation settings. No production test organizations or unsolicited confirmation emails.

## Baseline
Main4298648. Public Auth email signup is enabled; email confirmation is required. Login UI has no signup flow; register_tenant is service-role only. Existing active institution has two branches. Do not toggle/reassign existing institutions. Self-update of organization_members currently permits identity changes and must be closed before onboarding.

## Root-cause ledger
A legacy privileged registration RPC is not an appropriate public endpoint. Verified newly authenticated identities need an explicit bounded bootstrap; generic missing profiles must continue to fail closed. New institutions need both organization and branch subscriptions.

## Change ledger
Implemented signup form, verified caller-only atomic bootstrap, separate public registration status/control and immutable membership binding guard. Extracted the existing branch seed implementation into one private helper shared by ordinary authorized branch creation and onboarding; no direct client access to the helper. Keep email confirmation redirect under the deployed app base path and reload role/settings caches after the pending identity receives its real profile. New owner profile is inserted only after its branch exists (required non-null branch_id).

## Verification ledger
Owned localhost: 99 integration checks passed across new onboarding, branch management, multi-tenant foundation and tenant data isolation. Includes full rollback after injected downstream failure, sequential idempotence, unverified and anonymous denial, existing-account preservation, owner cross-institution isolation, subscriptions and membership attack rejection. 16 focused component/contract checks passed including signup confirmation, no password provisioning RPC, safe errors, pending profile gating and existing inactive/missing/expired-session protections. At84b4ee2 the full DB job and both browser shards passed; frontend2078 passed with one outdated source-contract assertion failing. Updated that contract for pending setup and added a behavioral permissions-bootstrap regression (16 focused checks pass). Exact head c4cd46bd0e922f3bc23721b04e159bf08efd741a passed Verify main43045596396: frontend2080 passed; database1268 passed/1 skipped; both browser shards, browser-smoke and Pages continuity passed.

## Production gate
User authorizes activation from login. No data rewrites or RLS relaxation. Apply only tested migration after complete exact-head CI and preserve rollback through the public registration flag. Confirm served UI and public status without creating production test tenants. Rollback: super administrator pauses public registration in System controls, or trusted SQL sets config.security.allow_tenant_registration=false. This blocks new onboarding without disabling existing accounts or deleting any organization. Email delivery remains provided by existing Supabase Auth configuration; no production email test has been sent.

## Next action
Production migration20261111154608 applied after renewed owner approval (fresh confirmation request; tested SQL unchanged). PR623 merged at614c0da19a2cdebb586141fe96eb0c862bf70906. Main Verify43051685342 succeeded. Actual Pages43052778359 (build, production parity and deploy) succeeded for exact source614c0da19a2cdebb586141fe96eb0c862bf70906.

Read-only production checks: registration enabled, anonymous bootstrap denied, authenticated bootstrap granted, private seed direct execution denied, legacy anonymous registration denied. Counts unchanged:2 organizations,2 branches,34 users. Security advisors flag intentionally exposed SECURITY DEFINER endpoints; the status exposes only one boolean, bootstrap verifies own confirmed identity, and the toggle checks platform-admin authorization. Fixed search paths and explicit ACLs retained. Public HTTP status endpoint independently returned200 with enabled=true. No production test identities or emails. Published HTML/module verification is recorded in PR623 release body. No pending runtime action; monitor ordinary signup feedback without creating operational test data.

## Mandatory update protocol
Record actual evidence and blockers. Preserve concurrent main changes. Do not declare published until real Pages publication succeeds.
