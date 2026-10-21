# Stop Group 2 new clubs

This control stops new routed placements in Group 2. It does not stop canisters,
delete clubs, change membership, move media, or open a group. Already-assigned
clubs (including reservations made before the stop) keep their assignment and access.
Other accepting groups can continue receiving new clubs.

The router checks the existing deployment administrator signature, exact group,
target and registry revision. Anonymous users and ordinary users cannot stop it.
The control closes both general admission and any existing Group 2 test grant.
Deletion registry locks still apply; resolve a lock through the existing deletion
protocol rather than bypassing it. Stopped state is stable across upgrades.

## Setup and use

1. Deploy the updated shared router through the approved mainnet workflow.
2. In GitHub Settings → Environments, configure **group-2-admin-controls** with
   only authorized administrators as required reviewers and restrict release branches.
   This restricts the stop operation, not who may create a club.
3. Actions → **Stop Group 2 new clubs** → action **check**. Leave the other fields empty.
4. To stop, select **stop**, copy the checked revision into **expected_revision**,
   and enter **STOP GROUP 2 NEW CLUBS** in **confirmation**.
5. Confirm the run succeeds and its report verifies stopped state.

No owner principal, test UUID list or opening approval file is needed. If the
revision changes, check and review again. A lost reply requires status readback;
do not report success from an incomplete run. If Group 2 is unregistered, check
reports that it cannot receive routed placements.

This is a stop-only release. General opening and compatible general app routing
remain separate unfinished work; do not use the owner-only opening workflow to
open Group 2 to everyone. Nothing is deployed or opened by adding these controls.