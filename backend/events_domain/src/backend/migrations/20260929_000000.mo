import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  type Event = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; revision : Nat64 };
  type Rsvp = { event_id : Text; account_id : Text; state : Text; updated_at_ms : Nat64 };
  type Attendance = { event_id : Text; account_id : Text; present : Bool; note : Text };
  type LineupEntry = { event_id : Text; member : Text; slot : Text; team_id : ?Text };
  type OldDuty = { event_id : Text; account_id : Text; duty : Text };
  type Duty = { event_id : Text; account_id : Text; duty : Text; completed : Bool };
  type RosterEntry = { event_id : Text; account_id : Text; child_id : ?Text };
  type Recurrence = { event_id : Text; frequency : Text; until_ms : Nat64 };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var events : [Event];
    var rsvps : [Rsvp];
    var attendance : [Attendance];
    var lineups : [LineupEntry];
    var duties : [OldDuty];
    var roster : [RosterEntry];
    var recurrences : [Recurrence];
    var bulkAccessPrincipals : [Principal];
  };
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
    var bulkAccessPrincipals : [Principal];
  };
  // Adds a completion flag to duties. Existing duties start incomplete.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var events = old.events;
      var rsvps = old.rsvps;
      var attendance = old.attendance;
      var lineups = old.lineups;
      var duties = Array.map<OldDuty, Duty>(old.duties, func(d) {
        { event_id = d.event_id; account_id = d.account_id; duty = d.duty; completed = false }
      });
      var roster = old.roster;
      var recurrences = old.recurrences;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
    }
  };
};
