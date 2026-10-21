# Fix Group 2 club creation without weakening approval

## What will change
- Separate changes to approved group configuration from ordinary new-club reservations. Creating a club must not invalidate approval for every club.
- Keep creation blocked when group services, placement settings or opening permissions change without fresh verification.
- Verify creation, retry and access across both groups; existing clubs stay where they are.

## Technical approach
- Add a stable configuration revision to the router, separate from its existing assignment/deletion revision. Preserve the current revision and receipt checks for sessions, creation and deletion.
- Increment the configuration revision on every configuration or admission-policy mutation, but not on club reservation or health reporting. Audit all revision-changing paths and test both categories.
- Extend the governor-produced snapshot and authenticated registry reads to bind the exact configuration revision, complete group inventory and placement settings. Legacy snapshots fail closed until replaced; never manually advance the generated approval.
- Correct the frontend inventory comparison to use named domain/canister fields, rather than tuples passed to an object-based comparator.
- Add regression coverage for consecutive new clubs, revision drift, service/placement changes, interrupted creation and original-creator retry; run the existing routing and router tests.

## Release steps
The owner runs the router upgrade through the existing GitHub workflow, then generates a fresh approved snapshot and publishes the compatible app. No live upgrades, opening changes or club moves happen during implementation.

## Current evidence and limitation
The screenshot shows an approval-version mismatch. The code confirms every new-club reservation increments that same revision. The checked-in approval is revision 3; the current live revision and the outcome of the attempted club reservation could not be verified without an authenticated Internet Identity session.