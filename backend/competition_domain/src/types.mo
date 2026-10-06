module {
  public type RoleGrant = { user : Principal; role : Text; competition_id : Text; team_id : ?Text };
  public type Competition = { id : Text; club_id : Text; name : Text; season : Text; status : Text; description : ?Text; visibility : Text; points_win : Nat16; points_draw : Nat16; points_loss : Nat16; revision : Nat64 };
  public type TeamEntry = { competition_id : Text; team_id : Text; club_id : Text; status : Text; division_id : ?Text };
  public type JoinToken = { id : Text; competition_id : Text; team_id : Text; issued_by : Principal; expires_at_ms : Nat64; used : Bool };
  public type Season = { competition_id : Text; name : Text; status : Text; divisions : [Text]; revision : Nat64 };
  // Fixture detail fields mirror the Supabase competition_matches columns the
  // edit-match dialog writes (date/time, venue, pitch, round, durations,
  // notes, division). Scores and status stay under set_match_result.
  public type Match = { id : Text; competition_id : Text; home_team : Text; away_team : Text; status : Text; home_score : Nat16; away_score : Nat16; division_id : ?Text; scheduled_at_ms : ?Nat64; venue : ?Text; pitch_number : ?Text; round_number : ?Nat16; duration_minutes : ?Nat16; arrival_minutes_before : ?Nat16; notes : ?Text; revision : Nat64 };
  // Per-competition chat toggle. Revision supports optimistic locking like
  // other mutable rows in this canister.
  public type ChatSettings = { competition_id : Text; chat_enabled : Bool; admins_only : Bool; revision : Nat64 };
  // Standing invite record for a (competition, invitee) pair with explicit
  // status transitions (pending -> accepted | declined), mirroring the
  // generic invites pattern used elsewhere in the hybrid stack.
  public type CompetitionInvite = {
    id : Text;
    competition_id : Text;
    invitee : Principal;
    role : Text;
    team_id : ?Text;
    status : Text; // "pending" | "accepted" | "declined"
    created_by : Principal;
    created_at_ms : Nat64;
    responded_at_ms : ?Nat64;
  };
  // Competition-wide join link (as opposed to JoinToken, which is scoped to
  // a single registered team). Granting a role on claim, not a team entry.
  public type CompetitionJoinLink = {
    competition_id : Text;
    token : Text;
    role : Text;
    team_id : ?Text;
    revoked : Bool;
    created_by : Principal;
    created_at_ms : Nat64;
    revision : Nat64;
  };
  // Expression-of-interest submission (parent sign-up for a season).
  // Mirrors the Supabase eoi_submissions columns the EOI hooks read/write;
  // *_at_ms timestamps replace ISO strings, Principal replaces auth.uid().
  public type EoiSubmission = {
    id : Text;
    club_id : Text;
    season_id : Text;
    claim_token : Text;
    status : Text; // invited|submitted|preferences_completed|allocated|confirmed|registered|withdrawn
    source : Text; // website|app|admin
    parent_name : Text;
    parent_email : Text;
    parent_mobile : ?Text;
    parent_user_id : ?Principal;
    player_name : Text;
    player_dob : ?Text;
    player_gender : ?Text;
    age_group : ?Text;
    preferred_position : ?Text;
    preferred_teammates : ?Text;
    skill_level : ?Nat16;
    returning_player : Bool;
    game_days : [Text];
    training_days : [Text];
    extra_notes : ?Text;
    notes : ?Text;
    child_id : ?Text;
    assigned_team_id : ?Text;
    invite_sent_count : Nat16;
    invite_sent_at_ms : ?Nat64;
    submitted_at_ms : Nat64;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
    allocated_at_ms : ?Nat64;
    confirmed_at_ms : ?Nat64;
    registered_at_ms : ?Nat64;
    withdrawn_at_ms : ?Nat64;
    claimed_at_ms : ?Nat64;
    parent_confirmed_at_ms : ?Nat64;
    revision : Nat64;
  };
  public type EoiStats = {
    total : Nat;
    submitted : Nat;
    allocated : Nat;
    confirmed : Nat;
    registered : Nat;
    withdrawn : Nat;
    new_players : Nat;
    returning_players : Nat;
    // Form-view tracking has no canister store yet (NEEDS-CANISTER: no
    // eoi_form_views equivalent) — these two always report 0.
    views : Nat;
    conversion_rate : Float;
  };
  public type EoiTeamSuggestion = { age_group : Text; player_count : Nat; avg_skill : Float; submission_ids : [Text] };
  // Computed from entries (accepted|registered) and matches (completed) for
  // a set of competitions over a time window. broadcasts always reports 0 —
  // broadcast records stay in Supabase (competition_broadcasts) by design.
  public type CompetitionEngagementSummary = { competition_id : Text; active_teams : Nat; total_matches : Nat; results_entered : Nat; broadcasts : Nat };
  // Public, anonymous-readable preview behind a competition join link —
  // mirrors the Supabase SECURITY DEFINER RPCs (get_competition_by_join_token,
  // list_divisions_by_join_token, get_competition_join_token_status,
  // list_entered_team_ids_by_join_token) the join page reads pre-auth.
  // entered_team_ids covers entries with status accepted|invited.
  public type JoinLinkPreview = {
    competition_id : Text;
    name : Text;
    club_id : Text;
    season : Text;
    competition_status : Text;
    divisions : [Text];
    entered_team_ids : [Text];
  };
  public type State = {
    schema : Nat32;
    governor : Principal;
    roles : [RoleGrant];
    competitions : [Competition];
    entries : [TeamEntry];
    tokens : [JoinToken];
    seasons : [Season];
    matches : [Match];
    chatSettings : [ChatSettings];
    competitionInvites : [CompetitionInvite];
    competitionJoinLinks : [CompetitionJoinLink];
    eoiSubmissions : [EoiSubmission];
  };
  public type DivisionSetting = { competition_id : Text; division : Text; hide_ladder : Bool };
  public type Broadcast = { id : Text; competition_id : Text; sender : Principal; title : Text; body : Text; created_at_ms : Nat64 };
}
