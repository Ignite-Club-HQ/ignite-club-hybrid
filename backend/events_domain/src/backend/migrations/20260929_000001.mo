import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  type OldEvent = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; revision : Nat64 };
  type Event = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; event_type : Text; location : ?Text; cancelled : Bool; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; revision : Nat64 };
  type Rsvp = { event_id : Text; account_id : Text; state : Text; updated_at_ms : Nat64 };
  type Attendance = { event_id : Text; account_id : Text; present : Bool; note : Text };
  type LineupEntry = { event_id : Text; member : Text; slot : Text; team_id : ?Text };
  type Duty = { event_id : Text; account_id : Text; duty : Text; completed : Bool };
  type RosterEntry = { event_id : Text; account_id : Text; child_id : ?Text };
  type Recurrence = { event_id : Text; frequency : Text; until_ms : Nat64 };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var events : [OldEvent];
    var rsvps : [Rsvp];
    var attendance : [Attendance];
    var lineups : [LineupEntry];
    var duties : [Duty];
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
  // Adds event_type/location/cancelled to events. Existing events map to
  // training events with no location, not cancelled — matching the
  // provisional frontend mapping used before this field existed.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var events = Array.map<OldEvent, Event>(old.events, func(e) {
        { id = e.id; club_id = e.club_id; team_id = e.team_id; title = e.title; description = e.description; event_type = "training"; location = null; cancelled = false; creator = e.creator; starts_at_ms = e.starts_at_ms; ends_at_ms = e.ends_at_ms; revision = e.revision }
      });
      var rsvps = old.rsvps;
      var attendance = old.attendance;
      var lineups = old.lineups;
      var duties = old.duties;
      var roster = old.roster;
      var recurrences = old.recurrences;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
    }
  };
};
