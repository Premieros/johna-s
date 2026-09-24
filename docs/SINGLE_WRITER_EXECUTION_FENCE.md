# SINGLE-WRITER EXECUTION FENCE — JOHNA-S

Repository: `Premieros/johna-s`
Effective date: 2026-09-24
Mode: **SINGLE WRITER / NO PARALLEL EXECUTION**

## Purpose

Prevent execution drift caused by assuming that an unexpected commit belongs to another worker or parallel task.

For this repository, unless the user explicitly states otherwise in the current conversation, there is exactly **one writer** for the active execution branch.

## Hard rules

1. **Single executable branch**
   - Only the branch declared as `Current active branch` in `docs/CURRENT_WORK_PLAN.md` is executable.
   - Other sections historically labelled `ACTIVE` are backlog/history only and must never be treated as concurrent execution.
   - A different branch can become executable only after the user explicitly changes scope and the mandatory execution gate is updated first.

2. **Sequential writes only**
   - Reads may be parallel.
   - Repository writes must be sequential.
   - Never issue parallel write calls to the active branch.
   - Every successful write returns a commit SHA; that SHA becomes the exact expected branch HEAD for the next write.

3. **HEAD fence before every write**
   - Fetch the active branch HEAD immediately before each write.
   - It must equal the expected HEAD from the preceding successful write/read checkpoint.
   - If it does not match, do not write.

4. **Unexpected HEAD policy: STOP_AND_RECONCILE**
   - An unexpected HEAD is treated as **self-drift / unaccounted change**, never as “parallel work”.
   - Fetch the unexpected commit metadata and changed files.
   - Compare them with the active work log and the last known write result.
   - Classify each change as:
     - expected prior write;
     - interrupted/partially recorded write;
     - accidental drift;
     - user-authorized external change.
   - Continue only after the active log is reconciled to the actual repository state.

5. **No automatic acceptance of unknown commits**
   - Never say “a parallel commit appeared” unless the user explicitly confirms another writer exists.
   - Never adopt an unknown commit merely because it appears to match the current direction.
   - Unknown changes must be reviewed file-by-file first.

6. **Interruption recovery**
   - After any user interruption, “stop”, tool error, conflict, timeout, or cancelled workflow:
     1. fetch active branch HEAD;
     2. read the mandatory active log;
     3. read the mandatory execution gate in `CURRENT_WORK_PLAN.md`;
     4. inspect commits since the last recorded checkpoint;
     5. resume from repository state, not conversation memory.

7. **Small write groups**
   - One logical change per write group.
   - Prefer one file per repository write call.
   - Finish the group by updating the active log before starting a new logical change.
   - Do not mix architecture changes, test fixes, and unrelated cleanup in one group.

8. **Verification stability**
   - Once an exact-head Verify is started for a stage, stop writing unless the run reports a real failure that requires a fix.
   - Do not keep committing cosmetic/log changes that repeatedly cancel the run.
   - A verification result only applies to the exact HEAD it tested.

9. **Production remains separately gated**
   - This fence does not authorize merge, Production migration, feature activation, or data mutation.
   - Existing Full Verify + explicit approval gates remain mandatory.

## Required active-log markers

The mandatory active log must contain all of these exact markers:

- `Execution mode: **SINGLE_WRITER**`
- `Parallel execution: **FORBIDDEN**`
- `Unexpected HEAD policy: **STOP_AND_RECONCILE**`
- `Write mode: **SEQUENTIAL_ONLY**`

CI must fail if any marker is missing.

## Interpretation rule

If repository history and conversation memory disagree, repository history + mandatory active log win.

If repository history contains an unrecorded change, stop and reconcile; do not invent a second worker.
