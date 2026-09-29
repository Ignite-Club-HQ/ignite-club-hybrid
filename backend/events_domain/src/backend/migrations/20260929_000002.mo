import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  type OldEvent = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; event_type : Text; location : ?Text; cancelled : Bool; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; revision : Nat64 };
  type Event = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; event_type : Text; location : ?Text; cancelled : Bool; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; series_id : ?Text; revision : Nat64 };
  type Rsvp = { event_id : Text; account_id : Text; state : Text; updated_at_ms : Nat64 };
  type Attendance = { event_id : Text; account_id : Text; present : Bool; note : Text };
  type LineupEntry = { event_id : Text; member : Text; slot : Text; team_id : ?Text };
  type LineupPlayer = { member : Text; slot : Text; number : ?Nat16; x : ?Float; y : ?Float; bench : Bool };
  type LineupSnapshot = { event_id : Text; team_id : ?Text; formation : ?Text; team_size : Nat16; ball_x : ?Float; ball_y : ?Float; players : [LineupPlayer]; updated_by : Principal; updated_at_ms : Nat64; revision : Nat64 };
  type Duty = { event_id : Text; account_id : Text; duty : Text; completed : Bool };
  type RosterEntry = { event_id : Text; account_id : Text; child_id : ?Text };
  type Recurrence = { event_id : Text; frequency : Text; until_ms : Nat64 };
  type EventSeries = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; event_type : Text; location : ?Text; frequency : Text; first_starts_at_ms : Nat64; first_ends_at_ms : Nat64; until_ms : Nat64; creator : Principal; revision : Nat64 };
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
    var lineupSnapshots : [LineupSnapshot];
    var duties : [Duty];
    var roster : [RosterEntry];
    var recurrences : [Recurrence];
    var series : [EventSeries];
    var bulkAccessPrincipals : [Principal];
  };
  // Adds recurring series (series_id on events, new series table) and full
  // pitch-board lineup snapshots. Existing events are standalone
  // (series_id = null); both new tables start empty.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var events = Array.map<OldEvent, Event>(old.events, func(e) {
        { id = e.id; club_id = e.club_id; team_id = e.team_id; title = e.title; description = e.description; event_type = e.event_type; location = e.location; cancelled = e.cancelled; creator = e.creator; starts_at_ms = e.starts_at_ms; ends_at_ms = e.ends_at_ms; series_id = null; revision = e.revision }
      });
      var rsvps = old.rsvps;
      var attendance = old.attendance;
      var lineups = old.lineups;
      var lineupSnapshots = [];
      var duties = old.duties;
      var roster = old.roster;
      var recurrences = old.recurrences;
      var series = [];
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
    }
  };
};