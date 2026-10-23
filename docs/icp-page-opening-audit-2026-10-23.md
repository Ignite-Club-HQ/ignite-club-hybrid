# ICP page-opening audit — 23 October 2026

## Evidence and scope

The reported incident affects Events, Vault, chats and Home Next Up. Three independent audits examined the page reads and shared routing layer. The latest send-preview patch does not change those shared layers; reverting that patch would not address the defects below. No single cause of all four live failures is proven.

Available preview telemetry was signed out and used Supabase selection, not Paul's failing Internet Identity session. Public localhost navigation reaches `/auth` without a page error. This is not authenticated acceptance.

## Concrete faults repaired

- **Team chat:** header metadata read the default club canister rather than the team's owning group. It now uses team-scoped dispatch. Optional club labels have a bounded fallback.
- **Group chat:** metadata errors were converted to successful absence. Only explicit missing metadata returns null; admission and network errors propagate for retry.
- **Team messages:** existing-room reads waited for provisioning, then profiles and reactions. Existing messages now read first; provisioning is attempted only for explicit missing-room results. Profile/reaction enrichment runs concurrently with bounded fallback, not indefinitely.
- **Events:** optional club/team labels were inside the full detail deadline. A confirmed event now survives stalled labels. Query-local cancellation settles the read coordination promptly; the ICP SDK's already-submitted calls are not claimed to be cancelled or replayed.
- **Vault:** scoped access waited for unrelated any-Pro discovery and redundant team subscription reads. Only the applicable access checks gate opening. Folder/query links retain failure for explicit retry rather than consuming initialization silently; folder parent walks reject cycles.
- **Home:** `Promise.allSettled` still waited for the slowest unresolved club, personal-team read and metadata. Verified per-club event results now publish independently, maintaining member-event and tombstone filtering and separate per-team event reads. Individual reads are bounded and cancelled progress cannot update a later page. Incomplete results are not saved as complete Next Up/ICP snapshots.
- **Shared discovery:** ready-session membership refresh bypassed the initial opening deadline, leaving its shared pending slot stuck. Refresh now expires, retains the previous session, releases the slot and disposes late replacements. Ownership probes carry the single-group marker to avoid nested caller-wide discovery.

## Read-only live observations

- The pinned router responds to an anonymous registry call with `Authentication required`; this does not reveal the signed-in registry revision or prove approval validity.
- The same pinned router rejects `read_routing_approval` as an absent update method (`IC0536`). Current code needs that method only when configuration no longer matches the bundled approval. This is a deployment-compatibility risk, **not proof that this incident took that branch**. No router upgrade or safety bypass was performed.

## Validation and remaining acceptance

Focused regression batches cover wrong-group headers, stalled membership refresh/late disposal, confirmed events with stalled labels, scoped Vault access despite unrelated pending reads, progressive Home delivery and missing-only chat provisioning. Run in both ICP and Supabase configurations; existing dispatch, session, message and pending-send suites are included.

Live signed-in opening/readback still requires Paul's Internet Identity session. No canister deployment, publication, repository copy, controller change or funding occurred in this audit. Do not describe the original live incident as resolved until its authenticated flow succeeds.