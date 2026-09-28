import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "types";

persistent actor {
  var governor : Principal;
  var roles : [Types.RoleGrant];
  var events : [Types.Event];
  var rsvps : [Types.Rsvp];
  var attendance : [Types.Attendance];
  var lineups : [Types.LineupEntry];
  var duties : [Types.Duty];
  var roster : [Types.RosterEntry];
  var recurrences : [Types.Recurrence];

  func auth(caller : Principal) { if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required") };
  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };
  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };
  func hasRole(caller : Principal, role : Text, club : Text, team : ?Text) : Bool {
    roles.any(func(grant) {
      grant.user.equal(caller) and grant.role == role and grant.club_id == club and (grant.team_id == team or grant.team_id == null)
    })
  };
  func manages(caller : Principal, event : Types.Event) : Bool {
    let teamAllowed = switch (event.team_id) {
      case (?team) { hasRole(caller, "team_admin", event.club_id, ?team) or hasRole(caller, "coach", event.club_id, ?team) };
      case null { false };
    };
    isGovernor(caller) or hasRole(caller, "club_admin", event.club_id, null) or teamAllowed
  };
  func canView(caller : Principal, event : Types.Event) : Bool {
    if (caller.equal(Principal.anonymous())) return false;
    if (isGovernor(caller) or event.creator.equal(caller)) return true;
    switch (event.team_id) {
      case (?team) {
        hasRole(caller, "team_admin", event.club_id, ?team)
          or hasRole(caller, "coach", event.club_id, ?team)
          or hasRole(caller, "club_admin", event.club_id, null)
      };
      case null { hasRole(caller, "club_admin", event.club_id, null) };
    }
  };
  func replaceEvent(index : Nat, value : Types.Event) { events := Array.tabulate<Types.Event>(events.size(), func(position) { if (position == index) value else events[position] }) };
  func requireManage(caller : Principal, id : Text) : { #Ok : Types.Event; #Err : Text } {
    switch (events.find(func(item) = item.id == id)) {
      case null { #Err("Event not found") };
      case (?current) { if (not manages(caller, current)) #Err("Event management forbidden") else #Ok(current) };
    }
  };

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
    #Ok
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not isGovernor(caller)) return #Err("Governor only"); if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(club_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.club_id == club_id and item.team_id == team_id)) roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    #Ok
  };

  public shared ({ caller }) func create_event(club_id : Text, team_id : ?Text, title : Text, description : Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller); if (not valid(club_id) or not valid(title) or not valid(description) or starts_at_ms >= ends_at_ms) return #Err("Invalid event");
    let teamAllowed = switch (team_id) { case (?team) { hasRole(caller, "team_admin", club_id, ?team) or hasRole(caller, "coach", club_id, ?team) }; case null { false } };
    let allowed = isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or teamAllowed;
    if (not allowed) return #Err("Club or team admin required");
    let created : Types.Event = { id = "evt-" # club_id # "-" # Nat.toText(events.size()); club_id; team_id; title; description; creator = caller; starts_at_ms; ends_at_ms; revision = 1 };
    events := events.concat([created]); #Ok(created)
  };

  public shared ({ caller }) func update_event(id : Text, title : Text, description : Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        if (not valid(title) or not valid(description) or starts_at_ms >= ends_at_ms) return #Err("Invalid event update");
        let updated : Types.Event = { current with title; description; starts_at_ms; ends_at_ms; revision = current.revision + 1 };
        var index = 0;
        for (item in events.values()) { if (item.id == id) { replaceEvent(index, updated); return #Ok(updated) }; index += 1 };
        #Err("Event not found")
      };
    }
  };

  public shared ({ caller }) func set_rsvp(event_id : Text, account_id : Text, state : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_)) {};
    };
    if (not valid(account_id) or not valid(state)) return #Err("Invalid RSVP");
    let value : Types.Rsvp = { event_id; account_id; state; updated_at_ms = 0 };
    rsvps := rsvps.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); rsvps := rsvps.concat([value]); #Ok(value)
  };

  public shared ({ caller }) func set_attendance(event_id : Text, account_id : Text, present : Bool, note : Text) : async { #Ok : Types.Attendance; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_)) {};
    };
    if (not valid(account_id) or note.size() > 2000) return #Err("Invalid attendance");
    let value : Types.Attendance = { event_id; account_id; present; note };
    attendance := attendance.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); attendance := attendance.concat([value]); #Ok(value)
  };

  public shared ({ caller }) func add_lineup(event_id : Text, member : Text, slot : Text, team_id : ?Text) : async { #Ok : Types.LineupEntry; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    let value : Types.LineupEntry = { event_id; member; slot; team_id }; lineups := lineups.concat([value]); #Ok(value)
  };
  public shared ({ caller }) func set_duty(event_id : Text, account_id : Text, duty : Text) : async { #Ok : Types.Duty; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    let value : Types.Duty = { event_id; account_id; duty }; duties := duties.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); duties := duties.concat([value]); #Ok(value)
  };
  public shared ({ caller }) func set_roster(event_id : Text, account_id : Text, child_id : ?Text) : async { #Ok : Types.RosterEntry; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    let value : Types.RosterEntry = { event_id; account_id; child_id }; roster := roster.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); roster := roster.concat([value]); #Ok(value)
  };
  public shared ({ caller }) func set_recurrence(event_id : Text, frequency : Text, until_ms : Nat64) : async { #Ok : Types.Recurrence; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (frequency != "daily" and frequency != "weekly" and frequency != "monthly") return #Err("Invalid recurrence");
    let value : Types.Recurrence = { event_id; frequency; until_ms }; recurrences := recurrences.filter(func(item) = item.event_id != event_id); recurrences := recurrences.concat([value]); #Ok(value)
  };

  public query ({ caller }) func list_events(club_id : ?Text, team_id : ?Text) : async [Types.Event] {
    events.filter(func(item) =
      canView(caller, item)
        and (club_id == null or club_id == ?item.club_id)
        and (team_id == null or team_id == item.team_id)
    )
  };
  public query ({ caller }) func export_state() : async { #Ok : { schema : Nat32; governor : Principal; roles : [Types.RoleGrant]; events : [Types.Event]; rsvps : [Types.Rsvp]; attendance : [Types.Attendance]; lineups : [Types.LineupEntry]; duties : [Types.Duty]; roster : [Types.RosterEntry]; recurrences : [Types.Recurrence] }; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok({ schema = 1; governor; roles; events; rsvps; attendance; lineups; duties; roster; recurrences })
  };
};
