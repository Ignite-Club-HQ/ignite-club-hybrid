module {
  public type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  public type Event = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; revision : Nat64 };
  public type Rsvp = { event_id : Text; account_id : Text; state : Text; updated_at_ms : Nat64 };
  public type Attendance = { event_id : Text; account_id : Text; present : Bool; note : Text };
  public type LineupEntry = { event_id : Text; member : Text; slot : Text; team_id : ?Text };
  public type Duty = { event_id : Text; account_id : Text; duty : Text };
  public type RosterEntry = { event_id : Text; account_id : Text; child_id : ?Text };
  public type Recurrence = { event_id : Text; frequency : Text; until_ms : Nat64 };
  public type State = {
    var governor : Principal;
    var roles : [RoleGrant];
    var events : [Event];
    var rsvps : [Rsvp];
    var attendance : [Attendance];
    var lineups : [LineupEntry];
    var duties : [Duty];
    var roster : [RosterEntry];
    var recurrences : [Recurrence];
  };
}
