module {
  public type RoleGrant = { user : Principal; role : Text; competition_id : Text; team_id : ?Text };
  public type Competition = { id : Text; club_id : Text; name : Text; season : Text; status : Text; revision : Nat64 };
  public type TeamEntry = { competition_id : Text; team_id : Text; club_id : Text; status : Text };
  public type JoinToken = { id : Text; competition_id : Text; team_id : Text; issued_by : Principal; expires_at_ms : Nat64; used : Bool };
  public type Season = { competition_id : Text; name : Text; status : Text; revision : Nat64 };
  public type Match = { id : Text; competition_id : Text; home_team : Text; away_team : Text; status : Text; home_score : Nat16; away_score : Nat16; revision : Nat64 };
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