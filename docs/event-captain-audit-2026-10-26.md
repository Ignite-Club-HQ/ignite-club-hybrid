# Event captain audit — 26 October 2026

## Confirmed code issues and repairs

- The event attendance marker and Captain widget independently requested the same assignment using different query keys. The marker discovered the owner by event ID even when the event club was known and converted all failures into an empty assignment. Both now share an account/backend/club query; the marker has the same bounded read and preserves failures.
- Captain and goalkeeper reads now use the existing `read_event_honours` endpoint, which checks exact event visibility and admission. In-flight requests share only the exact authenticated actor and event; resolved data and errors are not retained by this helper.
- The season fallback used to run even when an event captain already existed or its lookup was failing. It now starts only after confirmed match-captain absence.
- Both captain queries automatically repeated failed 30-second reads and refreshed on focus. ICP retries are now explicit and repeat only the failed check. The Captain heading remains visible during reads; errors distinguish match versus season and explain failure categories without exposing raw infrastructure/fuel details.
- `readProfileSummaries` dispatched the membership feature with an empty scope. Active group routing refuses that call. Profiles are identity-owned, so this now uses the existing shared-person boundary, benefiting captain/POTM/goalkeeper names without changing membership permissions.
- Captain display labels are derived from the current authorized RSVP data so an early cached assignment does not permanently retain missing names.

## What the audit does not prove

- The recorded telemetry for this request contains no captain runtime/network failure. Paul's live failure is not reproduced in an authenticated Internet Identity session here.
- A legacy-query rejection alone is **not** a proven cause: `domains.ts` already adapts the exact `read_account_list_match_captains` and `read_account_list_team_captains` twins after the specific protected-read trap. Their presence and Candid signatures were checked.
- `read_event_honours` calls `historyResult`, which adds role/competition verification and a second admission check. Nested removal accounting is permitted up to the per-principal active-work limit; it is not an unconditional reentrancy failure. These verification waits can still fail if the live authority cannot answer.
- Season captains still require the team to exist in its owning club and the caller to be a current member. Backend admission failures, outdated deployed code, service capacity and membership rejection remain possible until actual protected-read results are observed.

## Remaining mutation risk

Changing a match captain currently removes old assignments and adds the new assignment through separate authorized calls. A failed add can leave the old assignment removed. This audit does not introduce an atomic replacement API, retry uncertain writes, change canisters or deploy an upgrade. Atomic replacement needs a separately tested backend change and protected release.

## Acceptance

Deploy the frontend, open the affected event as Paul, and verify the Captain section and player picker. If it fails, record whether the consolidated inline explanation identifies the match check or season check. Inspect that exact protected API response before making further backend changes; do not increase deadlines again or bypass admission.
## Follow-up — confirmed season-captain cause

Paul's screenshot showed the season check failing with a not-found category. `list_team_captains` / `read_account_list_team_captains` checked only `acl.teams`, which `save_team` never writes, so every in-app-created team answered "Team not found". These and the team player-position and child-team endpoints now use `liveTeamRef` (team records first, ACL fallback) with unchanged membership/manager checks. Requires the protected all-group club_domain upgrade.
