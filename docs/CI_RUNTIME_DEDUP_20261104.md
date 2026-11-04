# CI runtime and duplicate-work repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `docs/ci-runtime-release-evidence-20261104`
Current PR: `607`
Last updated: 2026-11-04
State: **BLOCKED**

## Work status
#606 is merged as65c4f247dd26db533682267a10a9e4ab75a64739. The CI configuration is active on main and all postmerge checks and verified Pages publication succeeded. No restaurant application or production database behavior was changed. Follow-up #607 hardens rename classification: use --no-renames so moving runtime code into a Markdown documentation path cannot hide the source deletion. Its full exact-head verification and release remain pending.

## Guardrails
All2054 original frontend tests remain; the suite is now2062 with8 new CI safety cases. All136 browser cases and database/security/RLS/business assertions remain. Database files remain serial in disposable GitHub CI Postgres. No production transactions, SQL migration, price-source change, printer change, paid upgrade or dependency upgrade.

## Baseline
Main #604 Verify41889062297: frontend411 files/2054 tests in236.13s; browser136 tests in3.7min. Vitest4.1.11 removed environmentMatchGlobs, so the old intended Node optimization was ineffective. Setup/environment cumulative sums are not wall-time measurements.

## Root-cause ledger
Pure file/schema tests unnecessarily started jsdom and React setup. Browser work was a second critical path. Docs-only edits repeated runtime verification/publication. The early worklog check started Vitest before the same suite ran.

## Change ledger
- Explicit Vitest4 Node/DOM projects:239 audited pure Node files use minimal setup; unclassified tests safely default to DOM. Isolation and assertions retained.
- Browser136 cases split68/68 into parallel shards; the original browser-smoke check requires both successes and each shard has its own artifact.
- Native Node worklog fail-fast replaces duplicate early Vitest startup. Existing same-head Fast Verify deduplication is preserved; CI/test configuration edits correctly request app checks.
- Only a narrow nonempty docs-only range can skip runtime jobs and publication. Unknown/code/config/dependency/test changes, missing bases and manual runs use full verification.
- Exact-SHA scope metadata is downloaded from the successful trusted main verification run and validated before publication. Old stale-source and production-parity guards remain.
- Previous Pages asset lookup ignores only positively identified skipped publication jobs; a missing or unconfirmed real deployment/archive still fails closed.

## Verification ledger
Local full frontend run retained the baseline suite; final exact-head CI proved412 files/2062 tests. Local focused CI/asset/worklog checks:24/24 in880ms. Browser list and actual CI both confirmed68+68=136. Typechecks, lint and YAML/job dependency checks passed.
PR exact headb953361aa5662e2ecdb7f62f08e5b833e3cb1713, Verify41898860690: every job success; frontend127.98s; browser shards1.5min/2.7min.
Main Verify41900029976: every job success; frontend129.09s. Frontend suite wall time improved about45% versus236.13s without dropping original tests.
Pages41900770949: build, production-parity and deploy success. The SHA-bound scope artifact was exercised during real publication.
Scope safety covers multi-commit code-then-doc pushes, unknown paths, manual/zero-base full verification, malformed/mismatched scope metadata, required browser aggregation and keeping real deployed assets.

## Production gate
Runtime code/config changes still require the complete exact-head verification and trusted current-main Pages gate. Documentation-only updates require successful native worklog/scope checks and do not rebuild or republish the app.

## Next action
The #606 release is complete. Finish and verify the #607 rename guard before the documentation-only follow-up. The latest published application remains the last verified runtime source. Rollback reverts #606 CI/test/config files only, with no database or restaurant data reversal.

## Mandatory update protocol
Record actual run IDs and timings. Never equate isolated test timing with whole-system restaurant performance, hide failures, remove operational/security coverage, or parallelize shared DB fixtures.
