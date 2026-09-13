# Execution Guardrails — Remaining Program Stages

Date: 2026-09-13
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Production branch: `main`

This file records the user's standing approval to continue the remaining staged work without pausing for a new approval at every intermediate step, subject to the hard safety gates below.

## 1. Non-negotiable data-preservation condition

No stage may damage, reset, rewrite, reseed, migrate for convenience, or otherwise alter existing user business data, current configuration, or any working model merely to simplify or refactor the system.

Before any write or migration:
- fetch the latest `main` and the active branch/PR;
- preserve existing production semantics unless the change is a proven defect correction;
- use Fresh/Test DB for destructive or end-to-end test setup;
- never use Production as a disposable test environment;
- migrations must be forward-only and append-only;
- no force push;
- no RLS weakening;
- no role-name authorization for non-Super-Admin users;
- no cross-branch or cross-warehouse fallback;
- no Production migration unless the corresponding Full Verify is Green.

If a required change could mutate historical business data, change balances, or rewrite existing documents, stop that specific change and isolate it as a separate reviewed migration with an explicit mapping and rollback-safe proof.

## 2. Standing approval for remaining stages

The user authorizes continuing the remaining planned stages in order, provided every stage passes its own regression and Full Verify gates and complies with this document.

Current remaining program order:
1. PR4 — Purchases End-to-End
2. PR5 — Sales / POS / Tables / Kitchen / Payments
3. PR6 — Shift / Finance / Reports
4. PR7 — Confirmed Legacy Cleanup

Printing / Offline / Mobile may continue as a separate controlled track, including the existing Premier Print Agent work, but it must not be merged into Production until its own verification and safety gates are Green.

## 3. Mandatory UX-improvement condition for every stage

Every stage must include a focused user-experience review in addition to backend correctness. The review must improve clarity and completeness without changing working business logic unnecessarily.

For every touched screen, dialog, wizard, table, or workflow, verify:
- required actions are actually reachable from the UI;
- if a required action has no button or entry point, add one with the correct permission guard;
- if the user must complete a prerequisite, guide them to it instead of showing a raw backend error;
- if a screen has duplicate buttons, duplicated information, duplicated menu items, or repeated controls with the same purpose, remove or consolidate the duplication after proving there is no distinct behavior;
- if a label, status, warning, field, or action is unclear, rewrite it to be explicit in Arabic-first wording;
- if a warning is informational and does not block the workflow, it must not look like a fatal error;
- if an operation is blocked, show the exact reason and next action the user can take;
- keep important actions visible and touch-friendly;
- do not hide a feature merely because the backend was simplified;
- preserve permission-first behavior: hidden/disabled actions must reflect actual permissions, not role names;
- preserve branch and warehouse context visibly where confusion could cause a wrong transaction;
- add regression coverage for any UX guard that protects business behavior.

Examples of acceptable UX improvements:
- add a missing Edit / Retry / Select Warehouse / Open Shift / Create Raw Material / Go to Setup button when the action is already supported by the business contract;
- convert a red fatal-looking banner into a non-blocking warning when the backend contract allows continuation;
- consolidate duplicated controls that trigger the same action;
- clarify ambiguous Arabic labels and status messages;
- show the acting user's name, branch, warehouse, document status, or source when that context helps prevent mistakes.

## 4. Stage completion gate

No stage is considered closed until all of the following are true:
- focused functional tests pass;
- permission / branch / warehouse isolation tests pass where applicable;
- relevant idempotency tests pass;
- UX review for touched surfaces is completed;
- no regression in existing working flows;
- Full Verify is Green;
- the stage report records what changed, what was intentionally not changed, and any deferred risks;
- Production data remains preserved.

## 5. Merge policy

The user has authorized merge of completed remaining stages when their stage-specific Full Verify is Green and the diff remains within the approved scope and this safety policy.

This standing approval does not authorize:
- weakening security or tests;
- force push;
- touching another repository or Supabase project;
- rewriting existing business data for convenience;
- merging a failed or incomplete stage;
- applying an unverified Production migration.

## 6. Product principle

**Simple inside. Same capabilities outside. Clearer for the user.**

Backend simplification must reduce duplication and legacy risk while preserving user-facing capabilities. UX changes should make the system easier to understand and operate, not merely make the code cleaner.