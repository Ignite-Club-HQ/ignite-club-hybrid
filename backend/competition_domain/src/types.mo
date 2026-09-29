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
  public type State = {
    schema : Nat32;
    governor : Principal;
    roles : [RoleGrant];
    competitions : [Competition];
    entries : [TeamEntry];
    tokens : [JoinToken];
    seasons : [Season];
    matches : [Match];
  };
}