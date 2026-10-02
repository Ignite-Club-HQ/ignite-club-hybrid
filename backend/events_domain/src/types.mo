module {
  public type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  // deleted: soft-delete flag added for delete_event/soft_delete_series — existing
  // rows migrate with deleted = false.
  public type Event = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; event_type : Text; location : ?Text; cancelled : Bool; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; series_id : ?Text; revision : Nat64; deleted : Bool };
  // Association-scoped fan-out parent (Phase 3, F5) — mirrors the Supabase
  // events row with association_id set and association_event_id null. Kept
  // as a separate store so the core Event type (and every existing event
  // flow) is untouched; child_event_ids links the per-club fan-out events.
  public type AssociationEvent = {
    id : Text;
    association_id : Text;
    title : Text;
    description : Text;
    location : ?Text;
    starts_at_ms : Nat64;
    ends_at_ms : Nat64;
    created_by : Principal;
    created_at_ms : Nat64;
    child_event_ids : [Text];
    deleted : Bool;
  };
  // Widened to mirror Supabase rsvps: child_id/notes/has_paid/source added on
  // top of the original (event_id, account_id, state, updated_at_ms) shape.
  // Existing rows migrate with child_id = null, notes = "", has_paid = null,
  // source = "member".
  public type Rsvp = { event_id : Text; account_id : Text; child_id : ?Text; state : Text; notes : Text; has_paid : ?Bool; source : Text; updated_at_ms : Nat64 };
  public type Attendance = { event_id : Text; account_id : Text; present : Bool; note : Text };
  public type LineupEntry = { event_id : Text; member : Text; slot : Text; team_id : ?Text };
  // Full pitch-board snapshot per (event, team) — mirrors the Supabase
  // event_lineups snapshot: formation/team size, ball position, and every
  // player with shirt number, pitch coordinates and bench flag. Coordinates
  // are 0-100 pitch percentages as stored by the pitch board.
  public type LineupPlayer = { member : Text; slot : Text; number : ?Nat16; x : ?Float; y : ?Float; bench : Bool };
  public type LineupSnapshot = { event_id : Text; team_id : ?Text; formation : ?Text; team_size : Nat16; ball_x : ?Float; ball_y : ?Float; players : [LineupPlayer]; updated_by : Principal; updated_at_ms : Nat64; revision : Nat64 };
  public type Duty = { event_id : Text; account_id : Text; duty : Text; completed : Bool };
  public type RosterEntry = { event_id : Text; account_id : Text; child_id : ?Text };
  public type Recurrence = { event_id : Text; frequency : Text; until_ms : Nat64 };
  // A recurring series: one record plus generated child events linked by
  // series_id. Monthly recurrence steps a fixed 30 days (provisional — no
  // calendar math canister-side). deleted: soft-delete flag — soft_delete_series
  // sets this true and cascades to every child occurrence's own deleted flag
  // without removing rows (distinct from delete_series's hard cascade/trim).
  public type EventSeries = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; event_type : Text; location : ?Text; frequency : Text; first_starts_at_ms : Nat64; first_ends_at_ms : Nat64; until_ms : Nat64; creator : Principal; revision : Nat64; deleted : Bool };

  // ---- Attendance (class_attendance parity) ----
  // Mirrors Supabase class_attendance's status/marked_by/marked_at/notes
  // columns, scoped to a canister event instead of a class/term session.
  // subject_id is a PROVISIONAL text id (member account id or child id,
  // distinguished by subject_kind) until account/child ids are bound to
  // principals canister-side.
  public type EventAttendance = { event_id : Text; subject_id : Text; subject_kind : Text; status : Text; marked_by : Principal; marked_at_ms : Nat64; notes : Text };
  public type AttendanceInput = { subject_id : Text; subject_kind : Text; status : Text; notes : Text };

  // ---- Roster (rsvps + event_guests + children + child_guardians parity) ----
  // Mirrors Supabase event_guests: ad-hoc guest additions on an event not
  // tied to a member/child RSVP.
  public type EventGuest = { id : Text; event_id : Text; guest_name : Text; added_by : Principal; created_at_ms : Nat64 };
  // Minimal child reference — deliberately nameless. Child names are PII
  // and live only in pii_access_control; clients resolve display names via
  // its get_decrypted_pii_batch (club-scoped read grants let club members
  // read them). This canister stores only the id and parent linkage needed
  // to enrich roster reads.
  public type Child = { id : Text; parent_id : ?Text };
  // Mirrors Supabase child_guardians. guardian_id is a PROVISIONAL text id
  // matched against Principal.toText(caller), same convention as my_rsvps.
  public type ChildGuardian = { child_id : Text; guardian_id : Text; is_primary : Bool };
  public type RsvpWithChild = { rsvp : Rsvp; child : ?Child };
  public type EventRoster = { rsvps : [RsvpWithChild]; guests : [EventGuest] };

  // ---- Coach notes (per event, coach/admin only) ----
  public type CoachNote = { event_id : Text; note : Text; updated_by : Principal; updated_at_ms : Nat64 };

  // ---- Event views / reminder log / push reachability (NEEDS-CANISTER #4) ----
  // One row per view; count queries fold over this. Delivery of reminders
  // and push notifications themselves stays off-chain — this canister only
  // records what happened.
  public type EventView = { event_id : Text; viewer : Principal; viewed_at_ms : Nat64 };
  public type ReminderLog = { id : Text; event_id : Text; channel : Text; recipient : Text; sent_at_ms : Nat64 };
  public type PushReachability = { user : Principal; reachable : Bool; updated_at_ms : Nat64 };

  // ---- Event groups / players / duties (NEEDS-CANISTER #5) ----
  public type EventGroup = { id : Text; event_id : Text; name : Text; created_at_ms : Nat64; team_letter : ?Text; colour : ?Text; team_b_colour : ?Text; display_order : Nat16; ability_band : ?Text; pitch_name : ?Text };
  // Players + per-group duties supplied to replace_event_groups when creating a group in the same atomic batch.
  public type GroupPlayerInput = { account_id : Text; team_letter : ?Text };
  public type GroupDutyInput = { duty : Text; account_id : ?Text };
  public type GroupSpecInput = { name : Text; ability_band : ?Text; pitch_name : ?Text; display_order : Nat16; team_a_colour : ?Text; team_b_colour : ?Text; players : [GroupPlayerInput]; duties : [GroupDutyInput] };
  public type EventGroupPlayer = { group_id : Text; account_id : Text; team_letter : ?Text };
  // account_id = null -> open duty within a group, same convention as
  // OpenDuty below.
  public type EventGroupDuty = { group_id : Text; duty : Text; account_id : ?Text };

  // ---- Team training pauses (NEEDS-CANISTER #6) ----
  public type TeamTrainingPause = { id : Text; club_id : Text; team_id : Text; starts_at_ms : Nat64; ends_at_ms : Nat64; reason : Text; created_by : Principal; created_at_ms : Nat64 };

  // ---- Open duties (NEEDS-CANISTER #8) ----
  // Unassigned duty that any eligible member can claim via claim_open_duty.
  public type OpenDuty = { id : Text; event_id : Text; duty : Text; claimed_by : ?Text; created_at_ms : Nat64 };

  // ---- Workstream D: pitch board settings / game stats / game results / active game ----
  // Mirrors Supabase team_subscriptions pitch-board columns, keyed by team_id.
  public type PitchBoardSettings = {
    team_id : Text;
    rotation_speed : Nat16;
    disable_position_swaps : Bool;
    disable_batch_subs : Bool;
    rotate_gk_at_halftime : Bool;
    minutes_per_half : Nat16;
    max_spread_minutes : Nat16;
    team_size : Nat16;
    formation : ?Text;
    show_match_header : Bool;
    show_lineup_picker : Bool;
    updated_at_ms : Nat64;
  };

  // Mirrors Supabase game_summaries, replace-by-event-id semantics.
  public type GameSummary = {
    event_id : Text;
    team_id : Text;
    total_game_time : Nat32;
    half_duration : Nat32;
    formation_used : ?Text;
    total_substitutions : Nat16;
    updated_at_ms : Nat64;
  };

  // Mirrors Supabase game_player_stats rows. Caller passes event_id/team_id
  // once to save_game_player_stats; each input row omits them.
  public type GamePlayerStatInput = {
    user_id : ?Text;
    fill_in_player_name : ?Text;
    jersey_number : ?Nat16;
    minutes_played : Nat32;
    positions_played : [Text];
    substitutions_count : Nat16;
    started_on_pitch : Bool;
    goals_scored : Nat16;
  };
  public type GamePlayerStat = {
    event_id : Text;
    team_id : Text;
    user_id : ?Text;
    fill_in_player_name : ?Text;
    jersey_number : ?Nat16;
    minutes_played : Nat32;
    positions_played : [Text];
    substitutions_count : Nat16;
    started_on_pitch : Bool;
    goals_scored : Nat16;
  };

  // Mirrors Supabase game_results. period_scores/player_stats are opaque
  // JSON blobs (Text) — the canister has no cross-sport score/stat schema,
  // so it stores exactly what the client serializes (mirrors the Supabase
  // jsonb columns) and returns it back unparsed.
  public type GameResult = {
    id : Text;
    team_id : Text;
    event_id : ?Text;
    sport : Text;
    home_label : Text;
    away_label : Text;
    home_score : Nat32;
    away_score : Nat32;
    period_scores_json : Text;
    player_stats_json : Text;
    mvp_player_id : ?Text;
    mvp_player_name : ?Text;
    saved_by : Principal;
    updated_at_ms : Nat64;
  };

  // Mirrors Supabase active_games — server-side mirror used to drive
  // halftime/sub push notifications. timer_state_json/pitch_state_json are
  // opaque JSON blobs (Text), mirroring the Supabase jsonb columns.
  public type ActiveGame = {
    id : Text;
    user_id : Principal;
    team_id : ?Text;
    timer_state_json : Text;
    pitch_state_json : Text;
    board_session_id : Text;
    is_active : Bool;
    updated_at_ms : Nat64;
  };

  // ---- Mini-league-player RSVPs (NEEDS-CANISTER #9) ----
  // Separate from Rsvp (which is keyed by account_id) so a mini-league
  // player without an account can RSVP via their mini_league_players row id.
  public type RsvpSubject = { #account : Text; #mini_league_player : Text };
  public type MiniLeagueRsvp = { event_id : Text; subject : RsvpSubject; state : Text; updated_at_ms : Nat64 };

  // ---- Self-service child roster + child->team assignment (events-domain fix) ----
  // Mirrors Supabase child_team_assignments, scoped with club_id so
  // list_child_team_assignments can authorise on club membership.
  public type ChildTeamAssignment = { child_id : Text; team_id : Text; club_id : Text };

  public type State = {
    var governor : Principal;
    var roles : [RoleGrant];
    var events : [Event];
    var rsvps : [Rsvp];
    var attendance : [Attendance];
    var lineups : [LineupEntry];
    var lineupSnapshots : [LineupSnapshot];
    var duties : [Duty];
    var roster : [RosterEntry];
    var recurrences : [Recurrence];
    var series : [EventSeries];
    var eventAttendance : [EventAttendance];
    var eventGuests : [EventGuest];
    var children : [Child];
    var childGuardians : [ChildGuardian];
  };

  // ---- Workstream G: PlayHQ fixture/competition reads (HTTPS outcall) ----
  // Config is governor-set and holds a scoped PlayHQ API key — never
  // hardcoded. Mirrors messaging_domain's RecapConfig pattern.
  public type PlayHQConfig = { api_key : Text; base_url : Text; updated_at_ms : Nat64 };

  // Only the fields PlayHQTeamLinkCard actually renders (id/name/season) are
  // parsed out of PlayHQ's nested competition JSON — see findJsonStringValue
  // / extractJsonObjectArray in main.mo for the tolerant flat-object parser
  // and frontend/roadmap.md for the documented limitation.
  public type PlayHQCompetition = { id : Text; name : Text; season : ?Text };

  // Mirrors the shape PlayHQTeamLinkCard reads off Supabase's
  // competition_matches table (external_home_team_id/away_team_id +
  // home/away team names) so the card's playhqTeams derivation is unchanged.
  public type PlayHQMatch = {
    external_home_team_id : ?Text;
    external_away_team_id : ?Text;
    home_team_name : ?Text;
    away_team_name : ?Text;
  };
}
