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
  var bulkAccessPrincipals : [Principal];

  func auth(caller : Principal) { if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required") };
  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };
  // Mirrors the Supabase event_type enum so canister events round-trip with
  // the app's existing type handling.
  func validEventType(value : Text) : Bool {
    value == "game" or value == "training" or value == "social" or value == "mini_league"
  };
  func validLocation(value : ?Text) : Bool {
    switch (value) { case null true; case (?text) text.size() <= 256 }
  };
  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };
  func hasBulkAccess(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and bulkAccessPrincipals.any(func(p) = p.equal(caller))
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
  // Any role grant scoped to the club counts as membership for read
  // visibility (players, parents, coaches, admins). Mirrors the Supabase RLS
  // member-visibility rule so member-facing reads (home feed, schedule) work
  // for regular members, not just admins/coaches.
  func isClubMember(caller : Principal, club : Text) : Bool {
    roles.any(func(grant) = grant.user.equal(caller) and grant.club_id == club)
  };
  func canView(caller : Principal, event : Types.Event) : Bool {
    if (caller.equal(Principal.anonymous())) return false;
    if (isGovernor(caller) or event.creator.equal(caller)) return true;
    isClubMember(caller, event.club_id)
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

  public shared ({ caller }) func create_event(club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller); if (not valid(club_id) or not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or starts_at_ms >= ends_at_ms) return #Err("Invalid event");
    let teamAllowed = switch (team_id) { case (?team) { hasRole(caller, "team_admin", club_id, ?team) or hasRole(caller, "coach", club_id, ?team) }; case null { false } };
    let allowed = isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or teamAllowed;
    if (not allowed) return #Err("Club or team admin required");
    let created : Types.Event = { id = "evt-" # club_id # "-" # Nat.toText(events.size()); club_id; team_id; title; description; event_type; location; cancelled = false; creator = caller; starts_at_ms; ends_at_ms; revision = 1 };
    events := events.concat([created]); #Ok(created)
  };

  public shared ({ caller }) func update_event(id : Text, title : Text, description : Text, event_type : Text, location : ?Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        if (not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or starts_at_ms >= ends_at_ms) return #Err("Invalid event update");
        let updated : Types.Event = { current with title; description; event_type; location; starts_at_ms; ends_at_ms; revision = current.revision + 1 };
        var index = 0;
        for (item in events.values()) { if (item.id == id) { replaceEvent(index, updated); return #Ok(updated) }; index += 1 };
        #Err("Event not found")
      };
    }
  };

  // Cancellation is separate from update_event so cancelling cannot
  // accidentally clobber other fields with stale browser state.
  public shared ({ caller }) func set_event_cancelled(id : Text, cancelled : Bool) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        let updated : Types.Event = { current with cancelled; revision = current.revision + 1 };
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
    // Re-setting the same duty keeps its completion state; renaming the duty
    // or assigning a different one starts incomplete.
    let completed = switch (duties.find(func(item) = item.event_id == event_id and item.account_id == account_id)) {
      case (?current) { current.duty == duty and current.completed };
      case null { false };
    };
    let value : Types.Duty = { event_id; account_id; duty; completed }; duties := duties.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); duties := duties.concat([value]); #Ok(value)
  };

  // NOTE: like set_rsvp/set_attendance, completion trusts the
  // browser-supplied account id until account ids are bound to principals
  // via identity_access — members mark their own duties complete.
  func setDutyCompleted(event_id : Text, account_id : Text, completed : Bool) : { #Ok : Types.Duty; #Err : Text } {
    switch (duties.find(func(item) = item.event_id == event_id and item.account_id == account_id)) {
      case null { #Err("Duty not found") };
      case (?current) {
        let updated : Types.Duty = { current with completed = completed };
        duties := duties.map(func(item) = if (item.event_id == event_id and item.account_id == account_id) { updated } else { item });
        #Ok(updated)
      };
    }
  };
  public shared ({ caller }) func complete_duty(event_id : Text, account_id : Text) : async { #Ok : Types.Duty; #Err : Text } {
    auth(caller);
    setDutyCompleted(event_id, account_id, true)
  };
  public shared ({ caller }) func uncomplete_duty(event_id : Text, account_id : Text) : async { #Ok : Types.Duty; #Err : Text } {
    auth(caller);
    setDutyCompleted(event_id, account_id, false)
  };
  public shared ({ caller }) func remove_duty(event_id : Text, account_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not duties.any(func(item) = item.event_id == event_id and item.account_id == account_id)) return #Err("Duty not found");
    duties := duties.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id));
    #Ok
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
  public shared ({ caller }) func addBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (principal.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (not bulkAccessPrincipals.any(func(p) = p.equal(principal))) { bulkAccessPrincipals := bulkAccessPrincipals.concat([principal]) };
    #Ok
  };

  public shared ({ caller }) func removeBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(principal));
    #Ok
  };

  public query ({ caller }) func listBulkAccessPrincipals() : async { #Ok : [Principal]; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok(bulkAccessPrincipals)
  };

  // Caller-scoped RSVP read for member-facing surfaces (home feed). Returns
  // only the caller's own RSVPs; the full export stays governor/bulk-access
  // gated below. PROVISIONAL: account_id is matched against the caller's
  // principal text until account ids are bound to principals post-deploy.
  public query ({ caller }) func my_rsvps() : async [Types.Rsvp] {
    auth(caller);
    let accountId = Principal.toText(caller);
    rsvps.filter(func(item) = item.account_id == accountId)
  };

  public query ({ caller }) func export_state() : async { #Ok : { schema : Nat32; governor : Principal; roles : [Types.RoleGrant]; events : [Types.Event]; rsvps : [Types.Rsvp]; attendance : [Types.Attendance]; lineups : [Types.LineupEntry]; duties : [Types.Duty]; roster : [Types.RosterEntry]; recurrences : [Types.Recurrence] }; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    #Ok({ schema = 1; governor; roles; events; rsvps; attendance; lineups; duties; roster; recurrences })
  };
};
