import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  type Event = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; event_type : Text; location : ?Text; cancelled : Bool; creator : Principal; starts_at_ms : Nat64; ends_at_ms : Nat64; series_id : ?Text; revision : Nat64 };
  type OldRsvp = { event_id : Text; account_id : Text; state : Text; updated_at_ms : Nat64 };
  type Rsvp = { event_id : Text; account_id : Text; child_id : ?Text; state : Text; notes : Text; has_paid : ?Bool; source : Text; updated_at_ms : Nat64 };
  type Attendance = { event_id : Text; account_id : Text; present : Bool; note : Text };
  type LineupEntry = { event_id : Text; member : Text; slot : Text; team_id : ?Text };
  type LineupPlayer = { member : Text; slot : Text; number : ?Nat16; x : ?Float; y : ?Float; bench : Bool };
  type LineupSnapshot = { event_id : Text; team_id : ?Text; formation : ?Text; team_size : Nat16; ball_x : ?Float; ball_y : ?Float; players : [LineupPlayer]; updated_by : Principal; updated_at_ms : Nat64; revision : Nat64 };
  type Duty = { event_id : Text; account_id : Text; duty : Text; completed : Bool };
  type RosterEntry = { event_id : Text; account_id : Text; child_id : ?Text };
  type Recurrence = { event_id : Text; frequency : Text; until_ms : Nat64 };
  type EventSeries = { id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text; event_type : Text; location : ?Text; frequency : Text; first_starts_at_ms : Nat64; first_ends_at_ms : Nat64; until_ms : Nat64; creator : Principal; revision : Nat64 };
  type EventAttendance = { event_id : Text; subject_id : Text; subject_kind : Text; status : Text; marked_by : Principal; marked_at_ms : Nat64; notes : Text };
  type EventGuest = { id : Text; event_id : Text; guest_name : Text; added_by : Principal; created_at_ms : Nat64 };
  type Child = { id : Text; name : Text; parent_id : ?Text };
  type ChildGuardian = { child_id : Text; guardian_id : Text; is_primary : Bool };

  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var events : [Event];
    var rsvps : [OldRsvp];
    var attendance : [Attendance];
    var lineups : [LineupEntry];
    var lineupSnapshots : [LineupSnapshot];
    var duties : [Duty];
    var roster : [RosterEntry];
    var recurrences : [Recurrence];
    var series : [EventSeries];
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
    var eventAttendance : [EventAttendance];
    var eventGuests : [EventGuest];
    var children : [Child];
    var childGuardians : [ChildGuardian];
    var bulkAccessPrincipals : [Principal];
  };
  // Adds Supabase-parity attendance marking (class_attendance), roster
  // enrichment (event_guests/children/child_guardians) and widens rsvps to
  // carry child_id/notes/has_paid/source. Existing rsvps migrate with
  // child_id = null, notes = "", has_paid = null, source = "member". New
  // tables (eventAttendance, eventGuests, children, childGuardians) start
  // empty.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var events = old.events;
      var rsvps = Array.map<OldRsvp, Rsvp>(old.rsvps, func(r) {
        { event_id = r.event_id; account_id = r.account_id; child_id = null; state = r.state; notes = ""; has_paid = null; source = "member"; updated_at_ms = r.updated_at_ms }
      });
      var attendance = old.attendance;
      var lineups = old.lineups;
      var lineupSnapshots = old.lineupSnapshots;
      var duties = old.duties;
      var roster = old.roster;
      var recurrences = old.recurrences;
      var series = old.series;
      var eventAttendance = [];
      var eventGuests = [];
      var children = [];
      var childGuardians = [];
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
    }
  };
};
