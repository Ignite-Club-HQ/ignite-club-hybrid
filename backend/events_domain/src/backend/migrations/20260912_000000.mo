import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  type Event = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; revision : Nat64 };
  type Rsvp = { event_id : Text; account_id : Text; state : Text; updated_at_ms : Nat64 };
  type Attendance = { event_id : Text; account_id : Text; present : Bool; note : Text };
  type LineupEntry = { event_id : Text; member : Text; slot : Text; team_id : ?Text };
  type Duty = { event_id : Text; account_id : Text; duty : Text };
  type RosterEntry = { event_id : Text; account_id : Text; child_id : ?Text };
  type Recurrence = { event_id : Text; frequency : Text; until_ms : Nat64 };
  type OldActor = {};
  type NewActor = {
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
  public func migration(_old : OldActor) : NewActor {
    { var governor = Principal.anonymous(); var roles = []; var events = []; var rsvps = []; var attendance = []; var lineups = []; var duties = []; var roster = []; var recurrences = [] }
  };
};
