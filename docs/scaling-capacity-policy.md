# Fill-first capacity preparation

Owner-approved starting thresholds: prepare at 70%, roll new clubs over at 80% of the tightest tested usable limit. Existing clubs are not moved. Low cycles require topping up, not expanding groups.

## Implemented

- `groupCapacityPolicy` measures the maximum used/tested-limit ratio across a complete expected resource set; unknown, missing, future, older-than-15-minute or foreign-deployment evidence fails closed.
- `groupPlacement` keeps the explicit current group below 80%, otherwise fills the most occupied eligible group. Only ready, approved/accepting, fueled, fresh groups in approved deployment/subnets qualify. No qualifying group returns a closed provisioning proposal, not permission to create a club.
- The authoritative router independently fills the most club-utilized eligible group below 80% of its governor-configured club and conservative heap budgets; exact integer ratios avoid rounding. Existing retry/assignment, fuel, freshness and deletion-lock behavior remains unchanged. The router does not yet represent processing or blob admission budgets: these must not be claimed as authoritative complete-resource enforcement.
- `prepare-group-capacity.yml` runs every 15 minutes (GitHub scheduling is best-effort), or manually. It reads `deploy/groups/capacity-evidence.json` and saves idempotent CLOSED preparation requests to `deploy/groups/capacity-requests.json`. A pending request or ready sibling suppresses duplicates. No deploy key, canister install, registration or enable path is reachable.
- Notification: when a run newly queues a request, it opens a GitHub issue titled "Prepare new group requested (70% capacity reached)" and marks the run failed with a clear message, so the owner is emailed and sees the red badge. Runs that only re-check an already-queued request stay silent and green.

## Still blocked, not automatic live creation

The current workspace has no verified complete capacity collector or tested processing-budget evidence. With no evidence file, the workflow reports that prerequisite and does nothing; stale evidence stops it. Do not supply invented limits or interpret management `memory_size` as blob admission capacity. `requiredResources` must come from the trusted full service/store inventory, not a user/browser selection; this offline module validates coverage against that supplied contract, not its independent completeness.

The workflow queues a request only. It does **not** create/install a new group's canisters. A production creation/install adapter and authenticated collector are still needed before actual automatic closed-canister preparation is possible. The existing manual configuration workflow remains for already-installed groups. Never turn a request into a fabricated installed provision record.

All production group-opening/account-access release gates stay unchanged and OFF. Deploying this router change requires the existing approved upgrade process. Full resource-capacity wiring and approval/readiness acceptance are prerequisites for live rollover. No mainnet changes or signed-in/native acceptance were run here.

## Evidence contract

The input has `policy` (deploymentId, currentGroupId, primarySubnet, approvedSubnets, additionalSubnetsEnabled) and `groups`. Each group has its matching deployment/subnet, clubs, enabled, ready, cyclesHealthy, existing byte/growth fields, and `capacity`: deploymentId, observedAtMs, requiredResources, readings. Every reading supplies resource, finite nonnegative used, positive testedLimit and a nonempty evidence reference. Units must match within each resource; include every storage admission, heap, processing and club-count limit from the approved inventory. Evidence references are provenance labels, not cryptographic attestations. Only the trusted operator collector may publish this file. Current time is taken by the script, not accepted from input.
## Live collector (batch 1)
The scheduled workflow reads each service's real memory and fuel (anonymous `memory_stats`/`cycles_balance`),
then `frontend/scripts/collect-group-capacity.ts` builds evidence against `deploy/groups/tested-limits.json`:
`{ deploymentId, groupId, subnetId, clubCount, storageLimitBytes: { <service>: bytes }, extra?: [...] }`.
Limits must come from load tests or app admission budgets (e.g. photo storage ~1.6 GB), never ICP headline memory.
Missing readings/limits write no evidence; low fuel blocks with "Top up". Processing limits go in `extra` once load-tested.
