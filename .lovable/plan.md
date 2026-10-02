# Close all remaining NEEDS-CANISTER gaps (2026-10-02)

Goal: every NEEDS-CANISTER item recorded in frontend/roadmap.md gets a real canister
method plus frontend wiring. No "not available" states, no faked empty reads.

Conventions (apply to every workstream):
- moc 1.16.1 at /root/.cache/mops/moc/1.16.1/moc (reinstall via `bun add -g ic-mops &&
  mops toolchain use moc 1.16.1` if /root was wiped); per-canister `cd backend/<c> && mops install`.
- Compile: `moc $(mops sources) --enhanced-migration src/backend/migrations --check src/main.mo`.
- New state: one self-contained timestamped migration under src/backend/migrations/, data-preserving.
- Regenerate .did (`--idl`, copy over <c>.did) and bindings via icp-bindgen into BOTH
  frontend/src/lab/bindings/<c>/ and frontend/src/lab/generated-contracts/<c>/.
- Gates: `node frontend/scripts/check-candid-drift.mjs`, typegate
  `node scripts/check-product-type-errors.mjs` (from frontend/), relevant vitest files.
- Frontend wiring via withFeatureBackend(<feature key>) in frontend/src/live/features/*;
  feature keys in frontend/src/live/featureBackend.ts. II users have user.id = principal.
- candid opt maps to [] | [T]; unwrap with candidOpt helpers in frontend/src/live/features/candid.ts.
- Update frontend/roadmap.md marking each item DONE.

## Workstream A — identity_access: batch profile lookup
- Add `get_profiles_by_ids(ids: vec text) -> vec Profile` query.
- Wire useProfiles.ts + lib/profileCache.ts (fetchAndCacheProfiles/prefetchProfiles) to ICP.

## Workstream B — club_domain: seasons, team history, invite stats
- Season record + store: `list_seasons(club_id)`, `get_current_season(club_id)`, save/create
  (draft/active/closed/archived statuses, distinct from enrolment "terms").
- `profile_team_history(profile_id) -> vec {membership_id; team_id; team_name; team_level_age;
  club_id; club_name; season_id; season_name; season_status; season_start_date; season_end_date; joined_at}`.
- `list_accepted_invites(club_id, since_ms, until_ms)` and `invite_stats(club_id, since_ms, until_ms)`.
- Wire useClubSeasons.ts, useSeasonAnalytics.ts, useProfileTeamHistory.ts, and
  ClubEngagementAnalyticsPage newMembers/prevNewMembers/inviteStats.

## Workstream C — competition_domain: EOI submissions + engagement summary
- New EOI submission entity (migration) + reads: list submissions, stats, team suggestions,
  my pending EOIs; mutations: confirm_eoi_placement, claim_eoi_by_token, update submission,
  update_eoi_status, assign_eoi_team, delete_eoi, allocate_eoi_to_team, resend/bulk-resend invite.
- `competition_engagement_summary(competition_ids, since_ms, until_ms) -> {active_teams,
  total_matches, results_entered, broadcasts}` (broadcasts may report 0 with a comment —
  broadcast records stay Supabase by design).
- Wire useMyEois.ts, useEoiAdmin.ts, useEoiPolish.ts, useEoiTeamBuilder.ts and the
  CompetitionPanel/engagement consumers.

## Workstream D — events_domain: pitch board + game state
- `pitch_board_settings` record + get/save by team_id (rotation_speed, disable_position_swaps,
  disable_batch_subs, rotate_gk_at_halftime, minutes_per_half, max_spread_minutes, team_size,
  formation, show_match_header, show_lineup_picker).
- Game stats: save_game_summary / save_game_player_stats (replace-by-event-id) +
  get_game_summary / list_game_player_stats.
- Game results: save_game_result (upsert by event_id) + get_game_result.
- Active games: sync_active_game / deactivate_active_game / get_active_game.
- Per-viewer event views: admin per-viewer list + per-user viewed-ids list.
- Event membership check (children/child_guardians based RSVP gating) so useEventMembership
  no longer fails open.
- Wire usePitchSettings.ts, useGameStats.ts, useSaveGameResult.ts, useActiveGameSync.ts,
  useEventViews.ts, useEventMembership.ts. Game-stats email stays Supabase (allowed exception).

## Workstream E — insights_domain: photo counters + activity logs
- `count_photos(club_id, since_ms, until_ms)` + `photo_engagement_totals(photo_ids)`.
- `list_user_activity(club_id?, since_ms, until_ms)` per-session page-view log
  (user_id, page_path, page_label, session_id, started_at_ms, duration_seconds).
- Wire ClubEngagementAnalyticsPage photos/photoEngagement and UserAnalyticsTab activityData.

## Workstream F — mini_league_domain: guardian status + child cleanup + join parity
- Pending-guardian status lookup (children.parent_id + guardian count) for ManagePlayersDialog.
- Cascade cleanup on player delete: children, child_mini_league_assignments, child_team_assignments.
- Parent-join notification parity (AddSecondParentDialog fan-out parity with Supabase path).
- Wire ManagePlayersDialog pending-status branch and delete cascade.

## Workstream G — events_domain: PlayHQ fixture reads
- PlayHQ competition/fixture reads via HTTPS outcall (import/materialise stays Supabase-only,
  as previously decided); wire PlayHQTeamLinkCard fixture reads.

## Final gate (after all workstreams)
- Full drift check, typegate, full vitest suite in 3 shards, preview build.
- Roadmap updated; remaining = deploy canisters + Placement Settings IDs + live II test.
