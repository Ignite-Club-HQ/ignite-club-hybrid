module {
  public type RoleGrant = { user : Principal; role : Text; competition_id : Text; team_id : ?Text };
  public type Competition = { id : Text; club_id : Text; name : Text; season : Text; status : Text; revision : Nat64 };
  public type TeamEntry = { competition_id : Text; team_id : Text; club_id : Text; status : Text; division_id : ?Text };
  public type JoinToken = { id : Text; competition_id : Text; team_id : Text; issued_by : Principal; expires_at_ms : Nat64; used : Bool };
  public type Season = { competition_id : Text; name : Text; status : Text; divisions : [Text]; revision : Nat64 };
  // Fixture detail fields mirror the Supabase competition_matches columns the
  // edit-match dialog writes (date/time, venue, pitch, round, durations,
  // notes, division). Scores and status stay under set_match_result.
  public type Match = { id : Text; competition_id : Text; home_team : Text; away_team : Text; status : Text; home_score : Nat16; away_score : Nat16; division_id : ?Text; scheduled_at_ms : ?Nat64; venue : ?Text; pitch_number : ?Text; round_number : ?Nat16; duration_minutes : ?Nat16; arrival_minutes_before : ?Nat16; notes : ?Text; revision : Nat64 };
  // Per-competition chat toggle. Revision supports optimistic locking like
  // other mutable rows in this canister.
  public type ChatSettings = { competition_id : Text; chat_enabled : Bool; revision : Nat64 };
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
  };
}
