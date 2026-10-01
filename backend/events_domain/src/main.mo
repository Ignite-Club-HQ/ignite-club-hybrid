import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "types";

persistent actor {
  var governor : Principal;
  var roles : [Types.RoleGrant];
  var events : [Types.Event];
  var rsvps : [Types.Rsvp];
  var attendance : [Types.Attendance];
  var lineups : [Types.LineupEntry];
  var lineupSnapshots : [Types.LineupSnapshot];
  var duties : [Types.Duty];
  var roster : [Types.RosterEntry];
  var recurrences : [Types.Recurrence];
  var series : [Types.EventSeries];
  var eventAttendance : [Types.EventAttendance];
  var eventGuests : [Types.EventGuest];
  var children : [Types.Child];
  var childGuardians : [Types.ChildGuardian];
  var bulkAccessPrincipals : [Principal];
  var coachNotes : [Types.CoachNote];
  var eventViews : [Types.EventView];
  var reminderLogs : [Types.ReminderLog];
  var pushReachability : [Types.PushReachability];
  var eventGroups : [Types.EventGroup];
  var eventGroupPlayers : [Types.EventGroupPlayer];
  var eventGroupDuties : [Types.EventGroupDuty];
  var teamTrainingPauses : [Types.TeamTrainingPause];
  var openDuties : [Types.OpenDuty];
  var miniLeagueRsvps : [Types.MiniLeagueRsvp];

  func auth(caller : Principal) { if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required") };
  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };
  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };
  // Mirrors the Supabase event_type enum so canister events round-trip with
  // the app's existing type handling.
  func validEventType(value : Text) : Bool {
    value == "game" or value == "training" or value == "social" or value == "mini_league"
  };
  func validLocation(value : ?Text) : Bool {
    switch (value) { case null true; case (?text) text.size() <= 256 }
  };
  // "fortnightly" mirrors the frontend recurring-series workflow's step
  // classification (createEventTransaction in createEventWorkflow.ts), which
  // buckets a 8-14 day gap as fortnightly distinct from weekly/monthly.
  func validFrequency(value : Text) : Bool {
    value == "daily" or value == "weekly" or value == "fortnightly" or value == "monthly"
  };
  // Recurrence step in milliseconds. Monthly steps a fixed 30 days —
  // provisional, no calendar math canister-side.
  func frequencyStepMs(frequency : Text) : Nat64 {
    if (frequency == "daily") 86_400_000
    else if (frequency == "weekly") 604_800_000
    else if (frequency == "fortnightly") 1_209_600_000
    else 2_592_000_000
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
  func managesClubTeam(caller : Principal, club_id : Text, team_id : ?Text, creator : Principal) : Bool {
    let teamAllowed = switch (team_id) {
      case (?team) { hasRole(caller, "team_admin", club_id, ?team) or hasRole(caller, "coach", club_id, ?team) };
      case null { false };
    };
    isGovernor(caller) or creator.equal(caller) or hasRole(caller, "club_admin", club_id, null) or teamAllowed
  };
  func manages(caller : Principal, event : Types.Event) : Bool {
    managesClubTeam(caller, event.club_id, event.team_id, event.creator)
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
  func canViewSeries(caller : Principal, item : Types.EventSeries) : Bool {
    if (caller.equal(Principal.anonymous())) return false;
    if (isGovernor(caller) or item.creator.equal(caller)) return true;
    isClubMember(caller, item.club_id)
  };
  func replaceEvent(index : Nat, value : Types.Event) { events := Array.tabulate<Types.Event>(events.size(), func(position) { if (position == index) value else events[position] }) };
  func requireManage(caller : Principal, id : Text) : { #Ok : Types.Event; #Err : Text } {
    switch (events.find(func(item) = item.id == id)) {
      case null { #Err("Event not found") };
      case (?current) { if (not manages(caller, current)) #Err("Event management forbidden") else #Ok(current) };
    }
  };
  func requireManageSeries(caller : Principal, id : Text) : { #Ok : Types.EventSeries; #Err : Text } {
    switch (series.find(func(item) = item.id == id)) {
      case null { #Err("Series not found") };
      case (?current) { if (not managesClubTeam(caller, current.club_id, current.team_id, current.creator)) #Err("Series management forbidden") else #Ok(current) };
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
    let created : Types.Event = { id = "evt-" # club_id # "-" # Nat.toText(events.size()); club_id; team_id; title; description; event_type; location; cancelled = false; creator = caller; starts_at_ms; ends_at_ms; series_id = null; revision = 1; deleted = false };
    events := events.concat([created]); #Ok(created)
  };

  // Creates a recurring series plus all child occurrences up to until_ms.
  // One call replaces the Supabase create_event_with_duties recurring
  // expansion; child events are ordinary events linked by series_id.
  // Shared series-creation core: builds the EventSeries record plus every
  // child occurrence up to until_ms. create_series and
  // create_recurring_series both funnel through this (the latter converts
  // an occurrence count into until_ms first) — mirrors the Supabase
  // convert_event_to_recurring_series RPC's parent+children expansion.
  func createSeriesInternal(caller : Principal, club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, frequency : Text, first_starts_at_ms : Nat64, first_ends_at_ms : Nat64, until_ms : Nat64) : { #Ok : { series : Types.EventSeries; events : [Types.Event] }; #Err : Text } {
    if (not valid(club_id) or not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or not validFrequency(frequency) or first_starts_at_ms >= first_ends_at_ms or first_starts_at_ms > until_ms) return #Err("Invalid series");
    let teamAllowed = switch (team_id) { case (?team) { hasRole(caller, "team_admin", club_id, ?team) or hasRole(caller, "coach", club_id, ?team) }; case null { false } };
    let allowed = isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or teamAllowed;
    if (not allowed) return #Err("Club or team admin required");
    let seriesId = "ser-" # club_id # "-" # Nat.toText(series.size());
    let created : Types.EventSeries = { id = seriesId; club_id; team_id; title; description; event_type; location; frequency; first_starts_at_ms; first_ends_at_ms; until_ms; creator = caller; revision = 1; deleted = false };
    let step = frequencyStepMs(frequency);
    let duration = first_ends_at_ms - first_starts_at_ms;
    // Cap at 366 occurrences to bound message/state size.
    let maxCount = Nat.min(366, Nat64.toNat((until_ms - first_starts_at_ms) / step) + 1);
    let base = events.size();
    let children = Array.tabulate<Types.Event>(maxCount, func(index) {
      let offset = step * Nat.toNat64(index);
      { id = "evt-" # club_id # "-" # Nat.toText(base + index); club_id; team_id; title; description; event_type; location; cancelled = false; creator = caller; starts_at_ms = first_starts_at_ms + offset; ends_at_ms = first_starts_at_ms + offset + duration; series_id = ?seriesId; revision = 1; deleted = false }
    });
    series := series.concat([created]);
    events := events.concat(children);
    #Ok({ series = created; events = children })
  };

  public shared ({ caller }) func create_series(club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, frequency : Text, first_starts_at_ms : Nat64, first_ends_at_ms : Nat64, until_ms : Nat64) : async { #Ok : { series : Types.EventSeries; events : [Types.Event] }; #Err : Text } {
    auth(caller);
    createSeriesInternal(caller, club_id, team_id, title, description, event_type, location, frequency, first_starts_at_ms, first_ends_at_ms, until_ms)
  };

  // Occurrence-count variant of create_series — mirrors
  // convert_event_to_recurring_series's "N occurrences" mode alongside its
  // "until date" mode. Only "weekly"/"fortnightly" are documented entry
  // points per the roadmap; daily/monthly remain accepted since
  // createSeriesInternal already validates them.
  public shared ({ caller }) func create_recurring_series(club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, frequency : Text, first_starts_at_ms : Nat64, first_ends_at_ms : Nat64, occurrences : ?Nat32, until_ms : ?Nat64) : async { #Ok : { series : Types.EventSeries; events : [Types.Event] }; #Err : Text } {
    auth(caller);
    if (not validFrequency(frequency)) return #Err("Invalid series");
    let step = frequencyStepMs(frequency);
    let resolvedUntil : Nat64 = switch (until_ms) {
      case (?value) value;
      case null {
        switch (occurrences) {
          case (?count) if (count == 0) return #Err("Invalid series") else first_starts_at_ms + step * Nat.toNat64(Nat32.toNat(count - 1));
          case null return #Err("occurrences or until_ms required");
        };
      };
    };
    createSeriesInternal(caller, club_id, team_id, title, description, event_type, location, frequency, first_starts_at_ms, first_ends_at_ms, resolvedUntil)
  };

  // Detaches a single occurrence from its series (series_id -> null) without
  // touching sibling occurrences or the series record itself — the
  // one-off-edit counterpart to delete_series's future-occurrences cascade.
  public shared ({ caller }) func detach_occurrence(event_id : Text) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        if (current.series_id == null) return #Err("Event is not part of a series");
        let updated : Types.Event = { current with series_id = null; revision = current.revision + 1 };
        var index = 0;
        for (item in events.values()) { if (item.id == event_id) { replaceEvent(index, updated); return #Ok(updated) }; index += 1 };
        #Err("Event not found")
      };
    }
  };

  // Updates series fields and every future (>= from_ms) child event's
  // details. Times of individual occurrences are preserved.
  public shared ({ caller }) func update_series(id : Text, title : Text, description : Text, event_type : Text, location : ?Text, from_ms : Nat64) : async { #Ok : Types.EventSeries; #Err : Text } {
    auth(caller);
    switch (requireManageSeries(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        if (not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location)) return #Err("Invalid series update");
        let updated : Types.EventSeries = { current with title; description; event_type; location; revision = current.revision + 1 };
        series := series.map(func(item) = if (item.id == id) updated else item);
        events := events.map(func(item) =
          if (item.series_id == ?id and item.starts_at_ms >= from_ms) {
            { item with title; description; event_type; location; revision = item.revision + 1 }
          } else item
        );
        #Ok(updated)
      };
    }
  };

  // Deletes future (>= from_ms) occurrences of a series and their dependent
  // rows. When no occurrences remain, the series record itself is removed;
  // otherwise its recurrence end is truncated to from_ms.
  public shared ({ caller }) func delete_series(id : Text, from_ms : Nat64) : async { #Ok : Nat32; #Err : Text } {
    auth(caller);
    switch (requireManageSeries(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_current)) {
        let doomed = events.filter(func(item) = item.series_id == ?id and item.starts_at_ms >= from_ms);
        let doomedIds = doomed.map(func(item) = item.id);
        func isDoomed(eventId : Text) : Bool { doomedIds.any(func(d) = d == eventId) };
        events := events.filter(func(item) = not (item.series_id == ?id and item.starts_at_ms >= from_ms));
        rsvps := rsvps.filter(func(item) = not isDoomed(item.event_id));
        attendance := attendance.filter(func(item) = not isDoomed(item.event_id));
        lineups := lineups.filter(func(item) = not isDoomed(item.event_id));
        lineupSnapshots := lineupSnapshots.filter(func(item) = not isDoomed(item.event_id));
        duties := duties.filter(func(item) = not isDoomed(item.event_id));
        roster := roster.filter(func(item) = not isDoomed(item.event_id));
        recurrences := recurrences.filter(func(item) = not isDoomed(item.event_id));
        if (not events.any(func(item) = item.series_id == ?id)) {
          series := series.filter(func(item) = item.id != id);
        } else {
          series := series.map(func(item) =
            if (item.id == id) { { item with until_ms = from_ms; revision = item.revision + 1 } } else item
          );
        };
        #Ok(Nat.toNat32(doomed.size()))
      };
    }
  };

  public query ({ caller }) func list_series(club_id : ?Text, team_id : ?Text) : async [Types.EventSeries] {
    series.filter(func(item) =
      not item.deleted
        and canViewSeries(caller, item)
        and (club_id == null or club_id == ?item.club_id)
        and (team_id == null or team_id == item.team_id)
    )
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
    let value : Types.Rsvp = { event_id; account_id; child_id = null; state; notes = ""; has_paid = null; source = "member"; updated_at_ms = nowMs() };
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

  // Full pitch-board snapshot per (event, team): formation, team size, ball
  // position and every player (on-pitch and bench). One upsert replaces the
  // per-player add_lineup mirroring which silently dropped formation, ball
  // position and bench players. Supersedes add_lineup for pitch-board saves.
  public shared ({ caller }) func save_lineup_snapshot(event_id : Text, team_id : ?Text, formation : ?Text, team_size : Nat16, ball_x : ?Float, ball_y : ?Float, players : [Types.LineupPlayer]) : async { #Ok : Types.LineupSnapshot; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (players.size() > 100) return #Err("Too many lineup players");
    let existing = lineupSnapshots.find(func(item) = item.event_id == event_id and item.team_id == team_id);
    let value : Types.LineupSnapshot = {
      event_id; team_id; formation; team_size; ball_x; ball_y; players;
      updated_by = caller; updated_at_ms = nowMs();
      revision = switch (existing) { case (?current) current.revision + 1; case null 1 };
    };
    lineupSnapshots := lineupSnapshots.filter(func(item) = not (item.event_id == event_id and item.team_id == team_id));
    lineupSnapshots := lineupSnapshots.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func get_lineup_snapshot(event_id : Text, team_id : ?Text) : async { #Ok : ?Types.LineupSnapshot; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(lineupSnapshots.find(func(item) = item.event_id == event_id and item.team_id == team_id))
      };
    }
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
    if (not validFrequency(frequency)) return #Err("Invalid recurrence");
    let value : Types.Recurrence = { event_id; frequency; until_ms }; recurrences := recurrences.filter(func(item) = item.event_id != event_id); recurrences := recurrences.concat([value]); #Ok(value)
  };

  // Per-event attendance roster for a caller who can view the event
  // (club/team member, manager or governor). Counterpart of the Supabase
  // `get_targeted_event_attendance_roster` RPC fallback used by
  // EventDetailPage; child display names are resolved client-side via
  // pii_access_control's get_decrypted_pii_batch (see live/features/vault.ts).
  public query ({ caller }) func get_event_roster(event_id : Text) : async { #Ok : [Types.RosterEntry]; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(roster.filter(func(item) = item.event_id == event_id))
      };
    }
  };

  public query ({ caller }) func list_events(club_id : ?Text, team_id : ?Text) : async [Types.Event] {
    events.filter(func(item) =
      not item.deleted
        and canView(caller, item)
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

  // ---- Attendance (class_attendance parity) ----
  func validAttendanceStatus(value : Text) : Bool {
    value == "present" or value == "absent" or value == "late" or value == "excused"
  };
  func validSubjectKind(value : Text) : Bool { value == "account" or value == "child" };

  // Coach/admin marks attendance for an event's subjects (members or
  // children). Replaces any prior record for the same (event, subject).
  public shared ({ caller }) func mark_attendance(event_id : Text, records : [Types.AttendanceInput]) : async { #Ok : [Types.EventAttendance]; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (records.size() > 200) return #Err("Too many attendance records");
    for (r in records.values()) {
      if (not valid(r.subject_id) or not validSubjectKind(r.subject_kind) or not validAttendanceStatus(r.status) or r.notes.size() > 2000) return #Err("Invalid attendance record");
    };
    let now = nowMs();
    let created = records.map(func(r : Types.AttendanceInput) : Types.EventAttendance {
      { event_id; subject_id = r.subject_id; subject_kind = r.subject_kind; status = r.status; marked_by = caller; marked_at_ms = now; notes = r.notes }
    });
    eventAttendance := eventAttendance.filter(func(item) = not (item.event_id == event_id and created.any(func(c) = c.subject_id == item.subject_id and c.subject_kind == item.subject_kind)));
    eventAttendance := eventAttendance.concat(created);
    #Ok(created)
  };

  // Full attendance roster for an event — coach/admin only (same gate as
  // mark_attendance), mirrors class_attendance reads.
  public query ({ caller }) func get_attendance(event_id : Text) : async { #Ok : [Types.EventAttendance]; #Err : Text } {
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(eventAttendance.filter(func(item) = item.event_id == event_id))
  };

  // Caller-scoped attendance read (PROVISIONAL: subject_id matched against
  // Principal.toText(caller), same convention as my_rsvps) — lets a member
  // see their own marked attendance without the coach/admin gate.
  public query ({ caller }) func my_attendance(event_id : ?Text) : async [Types.EventAttendance] {
    auth(caller);
    let accountId = Principal.toText(caller);
    eventAttendance.filter(func(item) = item.subject_id == accountId and (event_id == null or event_id == ?item.event_id))
  };

  // ---- Roster (rsvps + event_guests + children + child_guardians parity) ----
  func isClubMemberText(guardianId : Text, club : Text) : Bool {
    roles.any(func(grant) = Principal.toText(grant.user) == guardianId and grant.club_id == club)
  };

  // Coach/admin seeds minimal child records so roster reads can resolve
  // names — full child records remain owned by Supabase.
  public shared ({ caller }) func admin_upsert_child(id : Text, name : Text, parent_id : ?Text) : async { #Ok : Types.Child; #Err : Text } {
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    if (not valid(id) or not valid(name)) return #Err("Invalid child");
    let value : Types.Child = { id; name; parent_id };
    children := children.filter(func(item) = item.id != id); children := children.concat([value]); #Ok(value)
  };

  public shared ({ caller }) func admin_link_guardian(child_id : Text, guardian_id : Text, is_primary : Bool) : async { #Ok : Types.ChildGuardian; #Err : Text } {
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    if (not valid(child_id) or not valid(guardian_id)) return #Err("Invalid guardian link");
    let value : Types.ChildGuardian = { child_id; guardian_id; is_primary };
    childGuardians := childGuardians.filter(func(item) = not (item.child_id == child_id and item.guardian_id == guardian_id));
    childGuardians := childGuardians.concat([value]); #Ok(value)
  };

  public shared ({ caller }) func add_event_guest(event_id : Text, guest_name : Text) : async { #Ok : Types.EventGuest; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(guest_name)) return #Err("Invalid guest");
    let value : Types.EventGuest = { id = "guest-" # event_id # "-" # Nat.toText(eventGuests.size()); event_id; guest_name; added_by = caller; created_at_ms = nowMs() };
    eventGuests := eventGuests.concat([value]); #Ok(value)
  };

  public shared ({ caller }) func remove_event_guest(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (eventGuests.find(func(item) = item.id == id)) {
      case null { #Err("Guest not found") };
      case (?guest) {
        switch (requireManage(caller, guest.event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
        eventGuests := eventGuests.filter(func(item) = item.id != id);
        #Ok
      };
    }
  };

  // RSVPs for an event enriched with child names and standalone guests —
  // mirrors the joined rsvps + event_guests + children reads guardians and
  // coaches use to see who is coming. Visibility follows canView (any club
  // member, manager or governor), same as get_event_roster.
  public query ({ caller }) func event_roster(event_id : Text) : async { #Ok : Types.EventRoster; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        let enriched = rsvps.filter(func(item) = item.event_id == event_id).map(func(item) : Types.RsvpWithChild {
          let child = switch (item.child_id) { case (?cid) children.find(func(c) = c.id == cid); case null null };
          { rsvp = item; child }
        });
        #Ok({ rsvps = enriched; guests = eventGuests.filter(func(item) = item.event_id == event_id) })
      };
    }
  };

  // Guardian-scoped RSVP read: every RSVP for a child the caller guards,
  // optionally narrowed to one event or one club. PROVISIONAL: guardian_id
  // is matched against Principal.toText(caller), same convention as
  // my_rsvps/my_attendance.
  public query ({ caller }) func my_child_rsvps(event_id : ?Text, club_id : ?Text) : async [Types.RsvpWithChild] {
    auth(caller);
    let callerId = Principal.toText(caller);
    let myChildIds = childGuardians.filter(func(g) = g.guardian_id == callerId).map(func(g) = g.child_id);
    rsvps.filter(func(item) =
      (switch (item.child_id) { case (?cid) myChildIds.any(func(id) = id == cid); case null false })
        and (event_id == null or event_id == ?item.event_id)
        and (club_id == null or (switch (events.find(func(e) = e.id == item.event_id)) { case (?e) ?e.club_id == club_id; case null false }))
    ).map(func(item) : Types.RsvpWithChild {
      let child = switch (item.child_id) { case (?cid) children.find(func(c) = c.id == cid); case null null };
      { rsvp = item; child }
    })
  };

  // Mirrors the Supabase child_is_in_event_audience RPC. PROVISIONAL
  // definition: a child is in an event's audience if they already have an
  // RSVP for it, or one of their guardians is a role-holder in the event's
  // club (no team-roster table exists in this canister yet).
  public query ({ caller }) func child_is_in_event_audience(child_id : Text, event_id : Text) : async { #Ok : Bool; #Err : Text } {
    switch (events.find(func(e) = e.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        let hasRsvp = rsvps.any(func(r) = r.event_id == event_id and r.child_id == ?child_id);
        let guardianIsMember = childGuardians.any(func(g) = g.child_id == child_id and isClubMemberText(g.guardian_id, event.club_id));
        #Ok(hasRsvp or guardianIsMember)
      };
    }
  };

  // ---- Admin RSVP writes (admin_upsert_rsvp / admin_update_rsvp_status parity) ----
  func validRsvpStatus(value : Text) : Bool {
    value == "going" or value == "not_going" or value == "maybe" or value == "pending"
  };

  // Coach/admin sets (creates or replaces) an RSVP on behalf of a member or
  // child — the canister equivalent of the admin_upsert_rsvp RPC.
  public shared ({ caller }) func admin_upsert_rsvp(event_id : Text, account_id : Text, child_id : ?Text, status : Text, notes : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(account_id) or not validRsvpStatus(status) or notes.size() > 2000) return #Err("Invalid RSVP");
    let value : Types.Rsvp = { event_id; account_id; child_id; state = status; notes; has_paid = null; source = "admin"; updated_at_ms = nowMs() };
    rsvps := rsvps.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id and item.child_id == child_id));
    rsvps := rsvps.concat([value]);
    #Ok(value)
  };

  // Coach/admin flips just the status on an existing RSVP — the canister
  // equivalent of the admin_update_rsvp_status RPC. Errors if no matching
  // RSVP exists yet (use admin_upsert_rsvp to create one).
  public shared ({ caller }) func admin_update_rsvp_status(event_id : Text, account_id : Text, child_id : ?Text, status : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not validRsvpStatus(status)) return #Err("Invalid RSVP status");
    switch (rsvps.find(func(item) = item.event_id == event_id and item.account_id == account_id and item.child_id == child_id)) {
      case null { #Err("RSVP not found") };
      case (?current) {
        let updated : Types.Rsvp = { current with state = status; updated_at_ms = nowMs() };
        rsvps := rsvps.map(func(item) = if (item.event_id == event_id and item.account_id == account_id and item.child_id == child_id) updated else item);
        #Ok(updated)
      };
    }
  };

  public query ({ caller }) func export_state() : async { #Ok : { schema : Nat32; governor : Principal; roles : [Types.RoleGrant]; events : [Types.Event]; rsvps : [Types.Rsvp]; attendance : [Types.Attendance]; lineups : [Types.LineupEntry]; lineupSnapshots : [Types.LineupSnapshot]; duties : [Types.Duty]; roster : [Types.RosterEntry]; recurrences : [Types.Recurrence]; series : [Types.EventSeries]; eventAttendance : [Types.EventAttendance]; eventGuests : [Types.EventGuest]; children : [Types.Child]; childGuardians : [Types.ChildGuardian] }; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    #Ok({ schema = 3; governor; roles; events; rsvps; attendance; lineups; lineupSnapshots; duties; roster; recurrences; series; eventAttendance; eventGuests; children; childGuardians })
  };
};