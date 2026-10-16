# Recipe quantity unit label — approved display repair completion

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/recipe-quantity-unit-label-20261016`
Current PR: #0
Last updated: 2026-10-16 18:17 Africa/Cairo
State: **BLOCKED**

## Guardrails
Complete the already-approved #517 recipe-unit presentation scope only. No SQL, service query, quantity conversion, form value/onChange, save payload, operational writer, printing or Windows agent changes. One writer.

## Baseline
#517 merge41c6ee2de0ae7875e31c2155a8a23a5cbbd6c7f1 deployed successfully via38921920264. Production migration20261016150535 already applied/verified; do not replay. Approval for scope+rollout given18:04 Cairo.

## Root-cause ledger
Live review confirms unit labels in selectors/read-only quantities and new ingredient inputs, but existing editable recipe quantities retained their old label. Initial replacement used a different Arabic string and missed this case. This is incomplete presentation work, not a change to quantity calculations. The live Mini Burger quantity is now0.15kg (independent current data); this assistant did not change it.

## Change ledger
Append the configured unit from the already-loaded material options to the existing quantity label. Preserve exact input value expression, handler and all business logic. No additional reads.

## Verification ledger
Pending typecheck/build and exact-head Full Verify; postdeploy verify the actual editable field label and close without saving. Prior #517 production parity/catalog fingerprints remain unchanged.

## Production gate
Same unit-display purpose explicitly approved with #517. This corrective presentation-only follow-up completes that approved result; no new data or schema scope. BLOCKED until exact-head Full Verify Green; then merge/deploy with expected-head fence and verify live label, plus postmerge suites. No further owner approval is required for this same-scope completion.

## Next action
Run verification and complete deployment; never edit the live recipe as part of UI testing.

## Mandatory update protocol
Single writer. Reconcile unexpected head movement; record exact-head checks in PR release ledger without source-only CI churn. Recovery restores previous frontend only; never modify quantities or historical operational data.
