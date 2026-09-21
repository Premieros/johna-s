# Print Design Unification — 2026-09-21

## Scope
Unify cashier customer receipts, cashier OPEN CHECK prints, and kitchen station tickets on the approved fixed thermal template without changing printer routing, queue RPCs, Windows/Electron Print Agent behavior, print-once/reprint authorization, or station assignment.

## Rollback point
- main before this work: `eea177f893056ace796536fd6aa15075da25c58a`

## Guardrails
- No Production migration.
- No changes to cloud print tables/RPCs.
- No changes to station routing or Windows agent protocol.
- Keep text payload as fallback.
- Fixed approved customer form uses 80mm.
- Kitchen fixed template remains compact and keeps modifiers/notes.

## Changes
- OPEN CHECK now queues `text + template` instead of text-only.
- Customer fixed template and browser fallback are locked to 80mm so legacy branch settings such as 72mm cannot alter the approved geometry.
- Final receipts continue using the existing fixed template path.
- Kitchen cloud jobs continue using the existing fixed kitchen template path.
- Contract tests require OPEN CHECK fixed templates and approved width.

## Verification
Pending Full Verify on PR head before merge.
