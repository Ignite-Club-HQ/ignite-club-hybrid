# ICP-only cutover: full staged plan

Goal: with the backend set to ICP and canister IDs registered, the app works without Supabase (media bytes excepted). Four stages, each independently shippable and verifiable. Stages 1–2 are prerequisites; 3 is the bulk of the work; 4 is a deliberate scope decision.

## Stage A — Boot config without Supabase (blocker 1)

Problem: routing config and canister IDs live in the Supabase `app_settings` table. If Supabase is unreachable the app silently falls back to Supabase-everywhere and can't even learn it should be on ICP.

- Add a build-time boot config path: `IGNITE_LIVE_BACKEND_ROUTING_JSON` env (same schema as the `backend_routing_config` app_settings row) parsed in `loadBackendRouting.ts` as the base config; the Supabase row (when reachable) still overrides it. Canister IDs already have this pattern via `IGNITE_LIVE_ICP_CANISTER_IDS_JSON` — routing config gets the same treatment.
- When the Supabase read fails, apply the build-time config instead of "Supabase everywhere", and log distinctly so a failed override read is visible (no silent fallback).
- Cache the last successfully loaded config in localStorage and use it when both Supabase and build-time config are absent, so a transient Supabase outage doesn't flip a configured deployment back to Supabase.
- Tests: resolver precedence (stored > build-time > cache > default), failure-path behaviour.

## Stage B — Real identity on ICP (blocker 2)

Problem: `IcpAuthProvider` fabricates a Supabase-shaped user (fake email, placeholder profile, no roles), and anything calling `supabase.auth.getSession()` directly sees no session.

- `identity_access` canister: extend provisioning so `registerAccount` returns/creates a real profile record (display name, optional avatar ref, principal-linked account id). Motoko change + .did + bindings regen + migration note.
- New pure module `live/identityProfile.ts`: resolves "current user" from the II session + identity_access profile (name, avatar, roles from club_domain grants) into the same shape the UI expects, without touching supabase.auth.
- `IcpAuthProvider` uses `identityProfile.ts` instead of the fabricated stub; sign-out already clears the agent cache, extend it to clear the profile cache.
- Roles: read role grants from club_domain `listLiveRoleGrants` (already built) instead of the Supabase `user_roles` table when on ICP.
- Tests: profile resolution, role mapping, sign-out cleanup.

## Stage C — Route the remaining reads (blocker 3)

Problem: HomePage issues ~20 direct Supabase queries; ~316 files contain direct table queries. Only the nine routed feature areas work on ICP today.

Approach: route by surface, not all 316 files — many are deliberately Supabase-only (points, analytics, admin tooling).

- Home feed: wrap HomePage's direct queries (roles, events, teams, clubs, children, RSVPs, notifications) in a `live/features/homeFeed.ts` service behind `withFeatureBackend`, reusing the existing events/membership/notifications/home connectors. Add canister read methods where a shape is missing (likely: membership children list per guardian, club list per member — both have provisional functions already, need verification).
- Profile & children reads (CompleteProfilePage, session-refresh helpers): stop calling `supabase.auth.getSession()` directly; go through the Stage B identity layer.
- Per surface, mark explicitly as "Supabase-only by design" (points, analytics, admin tooling, mini-leagues) so the routing audit can assert no page is accidentally unrouted.
- Verification: runtime dry-run with simulated target + a scripted browser pass over the home feed, profile, events, competitions, vault, notifications, messaging screens confirming zero Supabase network calls when routing is ICP.

## Stage D — Realtime & push decision (blocker 4)

Problem: chat live updates, presence, media realtime, and push run on Supabase Realtime + edge functions; canisters are request/response.

- Implement polling fallback: when a feature routes to ICP, chat/messaging and notifications screens poll via query calls (interval-based, pause when tab hidden) instead of Supabase Realtime subscriptions.
- Presence (typing/online indicators): degrade gracefully on ICP — hidden or last-seen timestamps from canister data, no realtime presence.
- Push notifications: stay Supabase edge-function based (documented); on a fully ICP-only deployment push is out of scope and the UI must not assume it. Document this as a standing limitation, or optionally plan a future HTTP-outcall push worker canister (not built in this stage).

## Verification & rollout

- After each stage: typecheck, full legacy suite, build log check.
- Final gate (existing roadmap items): deploy canisters, register IDs in Placement Settings, verify II sign-in + live calls end-to-end, verify provisional field mappings against deployed canisters.
- Rollback per stage: routing config switch back to Supabase; Stage A adds no new failure modes since Supabase override still wins when present.

## Explicitly out of scope

- Media bytes on-chain (media_blob_store canister not built yet — separate workstream).
- Points, analytics, admin tooling, mini-leagues: Supabase-only by design.
- HTTP-outcall push worker canister.
