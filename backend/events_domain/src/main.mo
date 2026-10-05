import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Error "mo:core/Error";
import Timer "mo:core/Timer";
import Call "mo:ic/Call";
import IC "mo:ic/Types";
import Types "types";

persistent actor class Main(governorInit : Principal) {
  var governor : Principal;

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };
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
  var childTeamAssignments : [Types.ChildTeamAssignment];
  var associationEvents : [Types.AssociationEvent];
  var pitchBoardSettings : [Types.PitchBoardSettings];
  var gameSummaries : [Types.GameSummary];
  var gamePlayerStats : [Types.GamePlayerStat];
  var gameResults : [Types.GameResult];
  var activeGames : [Types.ActiveGame];
  var playHQConfig : ?Types.PlayHQConfig;
  // Governor-set notification_queue canister id for the event-reminder
  // fan-out hook. Fail-closed while unset, mirrors messaging_domain/club_domain.
  var notificationQueueCanister : ?Principal;
  // Governor-set club_domain canister id for the permanent-delete fan-out.
  // Fail-closed while unset: delete_club_data/delete_team_data reject every
  // caller until the deploy script wires this.
  var clubDomainCanister : ?Principal;
  // Scheduled RSVP reminders (hours before start); swept by _reminderTimer.
  var autoReminders : [{ event_id : Text; hours_before : Nat16; sent : Bool }];

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
  // Optional record-link id (mini_league_id) — same length bound as valid().
  func validOptId(value : ?Text) : Bool {
    switch (value) { case null true; case (?text) text.size() <= 128 }
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

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not isGovernor(caller)) return #Err("Governor only"); if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(club_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.club_id == club_id and item.team_id == team_id)) roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    #Ok
  };

  public shared ({ caller }) func create_event(club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, opponent : ?Text, address : ?Text, mini_league_id : ?Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller); if (not valid(club_id) or not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or not validLocation(opponent) or not validLocation(address) or not validOptId(mini_league_id) or starts_at_ms >= ends_at_ms) return #Err("Invalid event");
    let teamAllowed = switch (team_id) { case (?team) { hasRole(caller, "team_admin", club_id, ?team) or hasRole(caller, "coach", club_id, ?team) }; case null { false } };
    let allowed = isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or teamAllowed;
    if (not allowed) return #Err("Club or team admin required");
    let created : Types.Event = { id = "evt-" # club_id # "-" # Nat.toText(events.size()); club_id; team_id; title; description; event_type; location; cancelled = false; creator = caller; starts_at_ms; ends_at_ms; series_id = null; revision = 1; deleted = false; opponent; address; mini_league_id; updated_at_ms = nowMs() };
    events := events.concat([created]); #Ok(created)
  };

  // Association-scoped fan-out (Phase 3, F5): an association admin creates
  // the same social event in every selected member club in one call — the
  // canister counterpart of the Supabase association-create-club-event edge
  // function. association_id is the organising club's own id; the caller
  // must be its club admin (or governor/bulk access). Returns the number of
  // clubs the event was created for.
  public shared ({ caller }) func create_association_event(association_id : Text, club_ids : [Text], title : Text, description : Text, location : ?Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Nat16; #Err : Text } {
    auth(caller);
    if (not valid(association_id) or not valid(title) or not valid(description) or not validLocation(location) or starts_at_ms >= ends_at_ms) return #Err("Invalid event");
    if (club_ids.size() == 0 or club_ids.any(func(id) = not valid(id))) return #Err("Select at least one club");
    let allowed = isGovernor(caller) or hasBulkAccess(caller) or hasRole(caller, "club_admin", association_id, null);
    if (not allowed) return #Err("Association admin required");
    var created : [Types.Event] = [];
    var index = 0;
    for (club_id in club_ids.values()) {
      created := created.concat([({ id = "evt-" # club_id # "-" # Nat.toText(events.size() + index); club_id; team_id = null; title; description; event_type = "social"; location; cancelled = false; creator = caller; starts_at_ms; ends_at_ms; series_id = null; revision = 1; deleted = false; opponent = null; address = null; mini_league_id = null; updated_at_ms = nowMs() } : Types.Event)]);
      index += 1;
    };
    events := events.concat(created);
    let parent : Types.AssociationEvent = {
      id = "assoc-" # association_id # "-" # Nat.toText(associationEvents.size() + 1) # "-" # Nat64.toText(nowMs() % 1_000_000_000);
      association_id; title; description; location; starts_at_ms; ends_at_ms;
      created_by = caller;
      created_at_ms = nowMs();
      child_event_ids = created.map(func(e) = e.id);
      deleted = false;
    };
    associationEvents := associationEvents.concat([parent]);
    #Ok(Nat.toNat16(created.size()))
  };

  // Association panel read (Phase 3, F5): parents for one association,
  // visible to anyone the association's club admins would show it to —
  // callers must be a club admin of the association (or governor/bulk).
  // child_event_ids carries the fan-out so the panel can show counts.
  public query ({ caller }) func list_association_events(association_id : Text) : async { #Ok : [Types.AssociationEvent]; #Err : Text } {
    auth(caller);
    let allowed = isGovernor(caller) or hasBulkAccess(caller) or hasRole(caller, "club_admin", association_id, null);
    if (not allowed) return #Err("Association admin required");
    #Ok(associationEvents.filter(func(a) = a.association_id == association_id and not a.deleted))
  };

  // Child display record for award flows (Phase 3, F8): the awarding
  // coach/admin needs the child's name + parent for the player-of-the-match
  // notification. Gated to managers of the event, who can already see the
  // full roster (including children) via event_roster.
  public query ({ caller }) func get_event_child(event_id : Text, child_id : Text) : async { #Ok : Types.Child; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(err)) { #Err(err) };
      case (#Ok(_)) {
        switch (children.find(func(c) = c.id == child_id)) {
          case null { #Err("Child not found") };
          case (?child) { #Ok(child) };
        };
      };
    };
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
      { id = "evt-" # club_id # "-" # Nat.toText(base + index); club_id; team_id; title; description; event_type; location; cancelled = false; creator = caller; starts_at_ms = first_starts_at_ms + offset; ends_at_ms = first_starts_at_ms + offset + duration; series_id = ?seriesId; revision = 1; deleted = false; opponent = null; address = null; mini_league_id = null; updated_at_ms = nowMs() }
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

  // list_series_occurrences: the generated occurrence events for a series
  // (id + starts_at_ms/ends_at_ms + deleted), sorted oldest-first, so
  // SeriesEndDateEditor can compute which trailing occurrences a shortened
  // end date would trim, or how many new ones extending it would add.
  public query ({ caller }) func list_series_occurrences(series_id : Text) : async { #Ok : [{ id : Text; starts_at_ms : Nat64; ends_at_ms : Nat64; deleted : Bool }]; #Err : Text } {
    switch (series.find(func(item) = item.id == series_id)) {
      case null { #Err("Series not found") };
      case (?item) {
        if (not canViewSeries(caller, item)) return #Err("Forbidden");
        let occurrences = events.filter(func(e) = e.series_id == ?series_id);
        let sorted = occurrences.sort(func(a, b) = Nat64.compare(a.starts_at_ms, b.starts_at_ms));
        #Ok(sorted.map(func(e) = { id = e.id; starts_at_ms = e.starts_at_ms; ends_at_ms = e.ends_at_ms; deleted = e.deleted }));
      };
    }
  };

  public shared ({ caller }) func update_event(id : Text, title : Text, description : Text, event_type : Text, location : ?Text, opponent : ?Text, address : ?Text, mini_league_id : ?Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        if (not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or not validLocation(opponent) or not validLocation(address) or not validOptId(mini_league_id) or starts_at_ms >= ends_at_ms) return #Err("Invalid event update");
        let updated : Types.Event = { current with title; description; event_type; location; opponent; address; mini_league_id; starts_at_ms; ends_at_ms; revision = current.revision + 1; updated_at_ms = nowMs() };
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
        let updated : Types.Event = { current with cancelled; revision = current.revision + 1; updated_at_ms = nowMs() };
        var index = 0;
        for (item in events.values()) { if (item.id == id) { replaceEvent(index, updated); return #Ok(updated) }; index += 1 };
        #Err("Event not found")
      };
    }
  };

  public shared ({ caller }) func set_rsvp(event_id : Text, account_id : Text, state : Text, notes : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_)) {};
    };
    if (not valid(account_id) or not valid(state) or notes.size() > 2000) return #Err("Invalid RSVP");
    let value : Types.Rsvp = { event_id; account_id; child_id = null; state; notes; has_paid = null; source = "member"; updated_at_ms = nowMs() };
    rsvps := rsvps.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); rsvps := rsvps.concat([value]); #Ok(value)
  };

  // Note-only update on an existing RSVP (self-service), mirroring the
  // Supabase per-RSVP notes field — keeps the current state, only changes notes.
  public shared ({ caller }) func set_rsvp_note(event_id : Text, account_id : Text, notes : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (notes.size() > 2000) return #Err("Invalid note");
    switch (rsvps.find(func(item) = item.event_id == event_id and item.account_id == account_id and item.child_id == null)) {
      case null { #Err("RSVP not found") };
      case (?current) {
        let updated : Types.Rsvp = { current with notes; updated_at_ms = nowMs() };
        rsvps := rsvps.map(func(item) = if (item.event_id == event_id and item.account_id == account_id and item.child_id == null) updated else item);
        #Ok(updated)
      };
    }
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

  // Coach/admin seeds minimal child references (id + parent linkage only)
  // so roster reads can resolve which child an RSVP belongs to. Child
  // names are PII: they never enter this canister — clients resolve them
  // via pii_access_control's get_decrypted_pii_batch.
  public shared ({ caller }) func admin_upsert_child(id : Text, parent_id : ?Text) : async { #Ok : Types.Child; #Err : Text } {
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    if (not valid(id)) return #Err("Invalid child");
    let value : Types.Child = { id; parent_id };
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

  // ---- (1) Soft delete: event + series (cascades occurrences) ----
  // Soft-deletes a single event in place — distinct from any hard-delete
  // path; the row stays, deleted=true just hides it from list_events.
  public shared ({ caller }) func delete_event(id : Text) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        let updated : Types.Event = { current with deleted = true; revision = current.revision + 1 };
        var index = 0;
        for (item in events.values()) { if (item.id == id) { replaceEvent(index, updated); return #Ok(updated) }; index += 1 };
        #Err("Event not found")
      };
    }
  };

  // Soft-deletes a series and cascades deleted=true onto every child
  // occurrence, without removing any rows — the soft counterpart to
  // delete_series's hard cascade/truncate.
  public shared ({ caller }) func soft_delete_series(id : Text) : async { #Ok : Types.EventSeries; #Err : Text } {
    auth(caller);
    switch (requireManageSeries(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        let updated : Types.EventSeries = { current with deleted = true; revision = current.revision + 1 };
        series := series.map(func(item) = if (item.id == id) updated else item);
        events := events.map(func(item) = if (item.series_id == ?id) { { item with deleted = true } } else item);
        #Ok(updated)
      };
    }
  };

  // ---- (2) Coach notes (per event, coach/admin authorized) ----
  public shared ({ caller }) func set_coach_note(event_id : Text, note : Text) : async { #Ok : Types.CoachNote; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (note.size() > 4000) return #Err("Note too long");
    let value : Types.CoachNote = { event_id; note; updated_by = caller; updated_at_ms = nowMs() };
    coachNotes := coachNotes.filter(func(item) = item.event_id != event_id);
    coachNotes := coachNotes.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func get_coach_note(event_id : Text) : async { #Ok : ?Types.CoachNote; #Err : Text } {
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(coachNotes.find(func(item) = item.event_id == event_id))
  };

  // ---- (3) Per-occurrence series trim/extend ----
  // detach_occurrence (above) already trims a single occurrence off its
  // series. This is the inverse: append a brand-new occurrence to an
  // existing series (e.g. "add one more training date").
  public shared ({ caller }) func add_series_occurrence(series_id : Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Types.Event; #Err : Text } {
    auth(caller);
    switch (requireManageSeries(caller, series_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(item)) {
        if (starts_at_ms >= ends_at_ms) return #Err("Invalid occurrence");
        let created : Types.Event = {
          id = "evt-" # item.club_id # "-" # Nat.toText(events.size());
          club_id = item.club_id; team_id = item.team_id; title = item.title; description = item.description;
          event_type = item.event_type; location = item.location; cancelled = false; creator = caller;
          starts_at_ms; ends_at_ms; series_id = ?series_id; revision = 1; deleted = false;
          opponent = null; address = null; mini_league_id = null; updated_at_ms = nowMs();
        };
        events := events.concat([created]);
        #Ok(created)
      };
    }
  };

  // ---- (4) Event views, reminder log, push reachability ----
  public shared ({ caller }) func record_event_view(event_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        if (eventViews.filter(func(item) = item.event_id == event_id).size() >= 5000) return #Err("View log full for this event");
        eventViews := eventViews.concat([{ event_id; viewer = caller; viewed_at_ms = nowMs() }]);
        #Ok
      };
    }
  };

  public query ({ caller }) func get_event_view_count(event_id : Text) : async { #Ok : Nat32; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(Nat.toNat32(eventViews.filter(func(item) = item.event_id == event_id).size()))
      };
    }
  };

  // record_reminder_sent/list_reminders: the canister only logs that a
  // reminder was sent — actual delivery (push/email/SMS) stays off-chain.
  public shared ({ caller }) func record_reminder_sent(event_id : Text, channel : Text, recipient : Text) : async { #Ok : Types.ReminderLog; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(channel) or not valid(recipient)) return #Err("Invalid reminder");
    let value : Types.ReminderLog = { id = "rem-" # event_id # "-" # Nat.toText(reminderLogs.size()); event_id; channel; recipient; sent_at_ms = nowMs() };
    reminderLogs := reminderLogs.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func list_reminders(event_id : Text) : async { #Ok : [Types.ReminderLog]; #Err : Text } {
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(reminderLogs.filter(func(item) = item.event_id == event_id))
  };

  // Push reachability is a caller-set flag only; actual push delivery stays
  // off-chain (this just records whether a device can currently be reached).
  public shared ({ caller }) func set_push_reachable(reachable : Bool) : async { #Ok : Types.PushReachability; #Err : Text } {
    auth(caller);
    let value : Types.PushReachability = { user = caller; reachable; updated_at_ms = nowMs() };
    pushReachability := pushReachability.filter(func(item) = not item.user.equal(caller));
    pushReachability := pushReachability.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func get_push_reachable(principal : Principal) : async { #Ok : ?Bool; #Err : Text } {
    auth(caller);
    #Ok(switch (pushReachability.find(func(item) = item.user.equal(principal))) { case (?item) ?item.reachable; case null null })
  };

  // get_reminder_log: summary mirroring the Supabase event_reminder_log RPC
  // shape AttendanceSection expects (sent_at + recipients_count of the most
  // recent reminder batch — entries sharing the latest sent_at_ms).
  public query ({ caller }) func get_reminder_log(event_id : Text) : async { #Ok : { sent_at_ms : ?Nat64; recipients_count : Nat32 }; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        let logs = reminderLogs.filter(func(item) = item.event_id == event_id);
        if (logs.size() == 0) return #Ok({ sent_at_ms = null; recipients_count = 0 });
        var latest : Nat64 = 0;
        for (item in logs.values()) { if (item.sent_at_ms > latest) latest := item.sent_at_ms };
        let batch = logs.filter(func(item) = item.sent_at_ms == latest);
        #Ok({ sent_at_ms = ?latest; recipients_count = Nat.toNat32(batch.size()) });
      };
    }
  };

  // is_reachable: per-member notification-reachability read mirroring the
  // Supabase get_members_push_reachable RPC — true when the member has
  // self-reported any contact channel (set_push_reachable). account_id is
  // matched against Principal.toText(caller), the same provisional
  // account-id-is-principal-text convention used elsewhere (e.g. my_rsvps).
  public query ({ caller }) func is_reachable(account_id : Text) : async { #Ok : Bool; #Err : Text } {
    auth(caller);
    #Ok(pushReachability.any(func(item) = Principal.toText(item.user) == account_id and item.reachable))
  };

  // ---- (5) Event groups + players + duties ----
  public shared ({ caller }) func create_event_group(event_id : Text, name : Text, team_letter : ?Text, colour : ?Text, ability_band : ?Text, pitch_name : ?Text) : async { #Ok : Types.EventGroup; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(name)) return #Err("Invalid group name");
    let value : Types.EventGroup = { id = "grp-" # event_id # "-" # Nat.toText(eventGroups.size()); event_id; name; created_at_ms = nowMs(); team_letter; colour; team_b_colour = null; display_order = Nat.toNat16(eventGroups.size()); ability_band; pitch_name };
    eventGroups := eventGroups.concat([value]);
    #Ok(value)
  };

  func requireManageGroup(caller : Principal, group_id : Text) : { #Ok : Types.EventGroup; #Err : Text } {
    switch (eventGroups.find(func(item) = item.id == group_id)) {
      case null { #Err("Group not found") };
      case (?group) { switch (requireManage(caller, group.event_id)) { case (#Err(e)) #Err(e); case (#Ok(_)) #Ok(group) } };
    }
  };

  public shared ({ caller }) func rename_event_group(group_id : Text, name : Text) : async { #Ok : Types.EventGroup; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, group_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        if (not valid(name)) return #Err("Invalid group name");
        let updated : Types.EventGroup = { current with name };
        eventGroups := eventGroups.map(func(item) = if (item.id == group_id) updated else item);
        #Ok(updated)
      };
    }
  };

  // set_event_group_appearance: auto-generate/team-colour/ability-band/pitch
  // UI support — sets the optional display fields independently of the
  // group's name so a rename doesn't clobber them (and vice versa).
  public shared ({ caller }) func set_event_group_appearance(group_id : Text, team_letter : ?Text, colour : ?Text, ability_band : ?Text, pitch_name : ?Text, team_b_colour : ?Text) : async { #Ok : Types.EventGroup; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, group_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        let updated : Types.EventGroup = { current with team_letter; colour; ability_band; pitch_name; team_b_colour };
        eventGroups := eventGroups.map(func(item) = if (item.id == group_id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func delete_event_group(group_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, group_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_)) {
        eventGroups := eventGroups.filter(func(item) = item.id != group_id);
        eventGroupPlayers := eventGroupPlayers.filter(func(item) = item.group_id != group_id);
        eventGroupDuties := eventGroupDuties.filter(func(item) = item.group_id != group_id);
        #Ok
      };
    }
  };

  public query ({ caller }) func list_event_groups(event_id : Text) : async { #Ok : [Types.EventGroup]; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(eventGroups.filter(func(item) = item.event_id == event_id)) };
    }
  };

  public shared ({ caller }) func add_group_player(group_id : Text, account_id : Text, team_letter : ?Text) : async { #Ok : Types.EventGroupPlayer; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(account_id)) return #Err("Invalid player");
    let value : Types.EventGroupPlayer = { group_id; account_id; team_letter };
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == group_id and item.account_id == account_id));
    eventGroupPlayers := eventGroupPlayers.concat([value]);
    #Ok(value)
  };

  public shared ({ caller }) func remove_group_player(group_id : Text, account_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == group_id and item.account_id == account_id));
    #Ok
  };

  // Moves a player from one group to another (both groups must belong to
  // the same event the caller manages).
  public shared ({ caller }) func move_group_player(from_group_id : Text, to_group_id : Text, account_id : Text, team_letter : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, from_group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    switch (requireManageGroup(caller, to_group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == from_group_id and item.account_id == account_id));
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == to_group_id and item.account_id == account_id));
    eventGroupPlayers := eventGroupPlayers.concat([{ group_id = to_group_id; account_id; team_letter }]);
    #Ok
  };

  // Swaps two players sitting in two (possibly different) groups.
  // account_a moves into group_b taking team_b (account_b's former team/slot);
  // account_b moves into group_a taking team_a (account_a's former team/slot).
  public shared ({ caller }) func swap_group_players(group_a : Text, account_a : Text, team_a : ?Text, group_b : Text, account_b : Text, team_b : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, group_a)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    switch (requireManageGroup(caller, group_b)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == group_a and item.account_id == account_a));
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == group_b and item.account_id == account_b));
    eventGroupPlayers := eventGroupPlayers.concat([{ group_id = group_b; account_id = account_a; team_letter = team_b }, { group_id = group_a; account_id = account_b; team_letter = team_a }]);
    #Ok
  };

  public query ({ caller }) func list_group_players(group_id : Text) : async { #Ok : [Types.EventGroupPlayer]; #Err : Text } {
    switch (eventGroups.find(func(item) = item.id == group_id)) {
      case null { #Err("Group not found") };
      case (?group) {
        switch (events.find(func(item) = item.id == group.event_id)) {
          case null { #Err("Event not found") };
          case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(eventGroupPlayers.filter(func(item) = item.group_id == group_id)) };
        };
      };
    }
  };

  public shared ({ caller }) func set_group_duty(group_id : Text, duty : Text, account_id : ?Text) : async { #Ok : Types.EventGroupDuty; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(duty)) return #Err("Invalid duty");
    let value : Types.EventGroupDuty = { group_id; duty; account_id };
    eventGroupDuties := eventGroupDuties.filter(func(item) = not (item.group_id == group_id and item.duty == duty));
    eventGroupDuties := eventGroupDuties.concat([value]);
    #Ok(value)
  };

  public shared ({ caller }) func remove_group_duty(group_id : Text, duty : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupDuties := eventGroupDuties.filter(func(item) = not (item.group_id == group_id and item.duty == duty));
    #Ok
  };

  public query ({ caller }) func list_group_duties(group_id : Text) : async { #Ok : [Types.EventGroupDuty]; #Err : Text } {
    switch (eventGroups.find(func(item) = item.id == group_id)) {
      case null { #Err("Group not found") };
      case (?group) {
        switch (events.find(func(item) = item.id == group.event_id)) {
          case null { #Err("Event not found") };
          case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(eventGroupDuties.filter(func(item) = item.group_id == group_id)) };
        };
      };
    }
  };

  // ---- (6) Team training pauses ----
  func managesTeam(caller : Principal, club_id : Text, team_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or hasRole(caller, "team_admin", club_id, ?team_id) or hasRole(caller, "coach", club_id, ?team_id)
  };

  public shared ({ caller }) func create_team_training_pause(club_id : Text, team_id : Text, starts_at_ms : Nat64, ends_at_ms : Nat64, reason : Text) : async { #Ok : Types.TeamTrainingPause; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(team_id) or starts_at_ms >= ends_at_ms or reason.size() > 2000) return #Err("Invalid pause");
    if (not managesTeam(caller, club_id, team_id)) return #Err("Club or team admin required");
    let value : Types.TeamTrainingPause = { id = "pause-" # club_id # "-" # team_id # "-" # Nat.toText(teamTrainingPauses.size()); club_id; team_id; starts_at_ms; ends_at_ms; reason; created_by = caller; created_at_ms = nowMs() };
    teamTrainingPauses := teamTrainingPauses.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func list_team_training_pauses(club_id : Text, team_id : Text) : async { #Ok : [Types.TeamTrainingPause]; #Err : Text } {
    if (not isClubMember(caller, club_id) and not managesTeam(caller, club_id, team_id)) return #Err("Forbidden");
    #Ok(teamTrainingPauses.filter(func(item) = item.club_id == club_id and item.team_id == team_id))
  };

  public shared ({ caller }) func delete_team_training_pause(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (teamTrainingPauses.find(func(item) = item.id == id)) {
      case null { #Err("Pause not found") };
      case (?pause) {
        if (not managesTeam(caller, pause.club_id, pause.team_id) and not pause.created_by.equal(caller)) return #Err("Forbidden");
        teamTrainingPauses := teamTrainingPauses.filter(func(item) = item.id != id);
        #Ok
      };
    }
  };

  public query ({ caller }) func is_paused(club_id : Text, team_id : Text, at_ms : Nat64) : async { #Ok : Bool; #Err : Text } {
    if (not isClubMember(caller, club_id) and not managesTeam(caller, club_id, team_id)) return #Err("Forbidden");
    #Ok(teamTrainingPauses.any(func(item) = item.club_id == club_id and item.team_id == team_id and item.starts_at_ms <= at_ms and at_ms <= item.ends_at_ms))
  };

  // ---- (7) Membership / child-scope check helpers ----
  // Mirrors a team-roster-membership check other domains could replicate:
  // any role grant scoped to this club+team (or club-wide) counts as
  // membership, same convention as isClubMember.
  public query ({ caller }) func is_team_member(principal : Principal, club_id : Text, team_id : Text) : async Bool {
    roles.any(func(grant) = grant.user.equal(principal) and grant.club_id == club_id and (grant.team_id == ?team_id or grant.team_id == null))
  };

  // Mirrors a guardian-of-child check other domains could replicate against
  // their own guardian data; here it reads events_domain's own
  // childGuardians table (PROVISIONAL text-id convention, see ChildGuardian).
  public query ({ caller }) func is_guardian_of(principal : Principal, child_id : Text) : async Bool {
    childGuardians.any(func(item) = item.child_id == child_id and item.guardian_id == Principal.toText(principal))
  };

  // ---- (8) Open-duty creation / claiming ----
  public shared ({ caller }) func create_open_duty(event_id : Text, duty : Text) : async { #Ok : Types.OpenDuty; #Err : Text } {
    if (openDuties.filter(func(item) = item.event_id == event_id).size() >= 200) return #Err("Too many open duties for this event");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(duty)) return #Err("Invalid duty");
    let value : Types.OpenDuty = { id = "oduty-" # event_id # "-" # Nat.toText(openDuties.size()); event_id; duty; claimed_by = null; created_at_ms = nowMs() };
    openDuties := openDuties.concat([value]);
    #Ok(value)
  };

  public shared ({ caller }) func claim_open_duty(id : Text, account_id : Text) : async { #Ok : Types.OpenDuty; #Err : Text } {
    auth(caller);
    if (not valid(account_id)) return #Err("Invalid account");
    switch (openDuties.find(func(item) = item.id == id)) {
      case null { #Err("Open duty not found") };
      case (?current) {
        if (current.claimed_by != null) return #Err("Duty already claimed");
        let updated : Types.OpenDuty = { current with claimed_by = ?account_id };
        openDuties := openDuties.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func unclaim_open_duty(id : Text) : async { #Ok : Types.OpenDuty; #Err : Text } {
    auth(caller);
    switch (openDuties.find(func(item) = item.id == id)) {
      case null { #Err("Open duty not found") };
      case (?current) {
        switch (requireManage(caller, current.event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
        let updated : Types.OpenDuty = { current with claimed_by = null };
        openDuties := openDuties.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public query ({ caller }) func list_open_duties(event_id : Text) : async { #Ok : [Types.OpenDuty]; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(openDuties.filter(func(item) = item.event_id == event_id)) };
    }
  };

  // ---- Atomic replace-all-groups batch (auto-generate / copy-from-previous) ----
  // Builds every group + its players + its per-group duties in one call so a
  // mid-way failure never leaves half-created matches behind. When
  // delete_existing is true, all current groups/players/duties for the event
  // are dropped first (mirrors the Supabase replace_event_groups RPC).
  public shared ({ caller }) func replace_event_groups(event_id : Text, groups : [Types.GroupSpecInput], delete_existing : Bool) : async { #Ok : [Text]; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (groups.any(func(g) = not valid(g.name))) return #Err("Invalid group name");
    if (delete_existing) {
      let existingIds = eventGroups.filter(func(g) = g.event_id == event_id).map(func(g) = g.id);
      eventGroups := eventGroups.filter(func(g) = g.event_id != event_id);
      eventGroupPlayers := eventGroupPlayers.filter(func(p) = not existingIds.any(func(id) = id == p.group_id));
      eventGroupDuties := eventGroupDuties.filter(func(d) = not existingIds.any(func(id) = id == d.group_id));
    };
    let base = eventGroups.size();
    var newGroups : [Types.EventGroup] = [];
    var newPlayers : [Types.EventGroupPlayer] = [];
    var newDuties : [Types.EventGroupDuty] = [];
    var createdIds : [Text] = [];
    var index = 0;
    for (spec in groups.values()) {
      let id = "grp-" # event_id # "-" # Nat.toText(base + index);
      newGroups := newGroups.concat([{ id; event_id; name = spec.name; created_at_ms = nowMs(); team_letter = null; colour = spec.team_a_colour; team_b_colour = spec.team_b_colour; display_order = spec.display_order; ability_band = spec.ability_band; pitch_name = spec.pitch_name }]);
      newPlayers := newPlayers.concat(spec.players.map(func(p) : Types.EventGroupPlayer = { group_id = id; account_id = p.account_id; team_letter = p.team_letter }));
      newDuties := newDuties.concat(spec.duties.map(func(d) : Types.EventGroupDuty = { group_id = id; duty = d.duty; account_id = d.account_id }));
      createdIds := createdIds.concat([id]);
      index += 1;
    };
    eventGroups := eventGroups.concat(newGroups);
    eventGroupPlayers := eventGroupPlayers.concat(newPlayers);
    eventGroupDuties := eventGroupDuties.concat(newDuties);
    #Ok(createdIds)
  };

  // ---- Event-level duty listing (assignee-keyed duties, used by match duty distribution) ----
  public query ({ caller }) func list_duties(event_id : Text) : async { #Ok : [Types.Duty]; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(duties.filter(func(item) = item.event_id == event_id)) };
    }
  };

  // ---- Self-service child roster + child-team-assignment ----
  // Caller-scoped: every child the caller is a guardian of (own children via
  // Child.parent_id, plus any linked via ChildGuardian), same provisional
  // guardian_id-is-principal-text convention as my_child_rsvps.
  public query ({ caller }) func my_children() : async [Types.Child] {
    auth(caller);
    let callerId = Principal.toText(caller);
    let guardedIds = childGuardians.filter(func(g) = g.guardian_id == callerId).map(func(g) = g.child_id);
    children.filter(func(c) = (c.parent_id == ?callerId) or guardedIds.any(func(id) = id == c.id))
  };

  public shared ({ caller }) func admin_upsert_child_team_assignment(child_id : Text, team_id : Text, club_id : Text) : async { #Ok : Types.ChildTeamAssignment; #Err : Text } {
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller) and not hasRole(caller, "club_admin", club_id, null)) return #Err("Admin required");
    if (not valid(child_id) or not valid(team_id) or not valid(club_id)) return #Err("Invalid assignment");
    let value : Types.ChildTeamAssignment = { child_id; team_id; club_id };
    childTeamAssignments := childTeamAssignments.filter(func(item) = not (item.child_id == child_id and item.team_id == team_id));
    childTeamAssignments := childTeamAssignments.concat([value]);
    #Ok(value)
  };

  public shared ({ caller }) func remove_child_team_assignment(child_id : Text, team_id : Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Admin required");
    childTeamAssignments := childTeamAssignments.filter(func(item) = not (item.child_id == child_id and item.team_id == team_id));
    #Ok
  };

  // Scoped to club membership (same visibility convention as list_team_training_pauses).
  public query ({ caller }) func list_child_team_assignments(club_id : Text, team_id : Text) : async { #Ok : [Types.ChildTeamAssignment]; #Err : Text } {
    if (not isClubMember(caller, club_id)) return #Err("Forbidden");
    #Ok(childTeamAssignments.filter(func(item) = item.club_id == club_id and item.team_id == team_id))
  };

  // Every team a given child is assigned to, scoped to the caller being that
  // child's guardian (or governor/bulk) — used to scope RSVP eligibility.
  public query ({ caller }) func my_child_team_assignments(child_id : Text) : async { #Ok : [Types.ChildTeamAssignment]; #Err : Text } {
    auth(caller);
    let callerId = Principal.toText(caller);
    let isMyChild = childGuardians.any(func(g) = g.child_id == child_id and g.guardian_id == callerId)
      or children.any(func(c) = c.id == child_id and c.parent_id == ?callerId);
    if (not isMyChild and not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Forbidden");
    #Ok(childTeamAssignments.filter(func(item) = item.child_id == child_id))
  };

  // ---- (9) Mini-league-player RSVPs ----
  func subjectEquals(a : Types.RsvpSubject, b : Types.RsvpSubject) : Bool {
    switch (a, b) {
      case (#account(x), #account(y)) x == y;
      case (#mini_league_player(x), #mini_league_player(y)) x == y;
      case (_, _) false;
    }
  };
  func validSubject(value : Types.RsvpSubject) : Bool {
    switch (value) { case (#account(id)) valid(id); case (#mini_league_player(id)) valid(id) }
  };

  public shared ({ caller }) func set_mini_league_rsvp(event_id : Text, subject : Types.RsvpSubject, state : Text) : async { #Ok : Types.MiniLeagueRsvp; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not validSubject(subject) or not valid(state)) return #Err("Invalid RSVP");
    let value : Types.MiniLeagueRsvp = { event_id; subject; state; updated_at_ms = nowMs() };
    miniLeagueRsvps := miniLeagueRsvps.filter(func(item) = not (item.event_id == event_id and subjectEquals(item.subject, subject)));
    miniLeagueRsvps := miniLeagueRsvps.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func list_mini_league_rsvps(event_id : Text) : async { #Ok : [Types.MiniLeagueRsvp]; #Err : Text } {
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(miniLeagueRsvps.filter(func(item) = item.event_id == event_id)) };
    }
  };

  // ---- Workstream D: pitch board settings ----
  func canManageTeamBoard(caller : Principal, team_id : Text) : Bool {
    isGovernor(caller) or roles.any(func(g) {
      g.user.equal(caller) and g.team_id == ?team_id and (g.role == "team_admin" or g.role == "coach" or g.role == "club_admin")
    })
  };

  public query ({ caller }) func get_pitch_board_settings(team_id : Text) : async { #Ok : ?Types.PitchBoardSettings; #Err : Text } {
    auth(caller);
    #Ok(pitchBoardSettings.find(func(item) = item.team_id == team_id))
  };

  public shared ({ caller }) func save_pitch_board_settings(
    team_id : Text,
    rotation_speed : Nat16,
    disable_position_swaps : Bool,
    disable_batch_subs : Bool,
    rotate_gk_at_halftime : Bool,
    minutes_per_half : Nat16,
    max_spread_minutes : Nat16,
    team_size : Nat16,
    formation : ?Text,
    show_match_header : Bool,
    show_lineup_picker : Bool,
  ) : async { #Ok : Types.PitchBoardSettings; #Err : Text } {
    auth(caller);
    if (not canManageTeamBoard(caller, team_id)) return #Err("Pitch settings management forbidden");
    if (not valid(team_id)) return #Err("Invalid team");
    let value : Types.PitchBoardSettings = {
      team_id; rotation_speed; disable_position_swaps; disable_batch_subs; rotate_gk_at_halftime;
      minutes_per_half; max_spread_minutes; team_size; formation; show_match_header; show_lineup_picker;
      updated_at_ms = nowMs();
    };
    pitchBoardSettings := pitchBoardSettings.filter(func(item) = item.team_id != team_id).concat([value]);
    #Ok(value)
  };

  // ---- Workstream D: game summary + player stats (replace-by-event-id) ----
  public shared ({ caller }) func save_game_summary(
    event_id : Text,
    team_id : Text,
    total_game_time : Nat32,
    half_duration : Nat32,
    formation_used : ?Text,
    total_substitutions : Nat16,
  ) : async { #Ok : Types.GameSummary; #Err : Text } {
    auth(caller);
    if (not valid(event_id) or not valid(team_id)) return #Err("Invalid game summary");
    if (not canManageTeamBoard(caller, team_id)) return #Err("Game summary management forbidden");
    let value : Types.GameSummary = { event_id; team_id; total_game_time; half_duration; formation_used; total_substitutions; updated_at_ms = nowMs() };
    gameSummaries := gameSummaries.filter(func(item) = item.event_id != event_id).concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func get_game_summary(event_id : Text) : async { #Ok : ?Types.GameSummary; #Err : Text } {
    auth(caller);
    #Ok(gameSummaries.find(func(item) = item.event_id == event_id))
  };

  public shared ({ caller }) func save_game_player_stats(
    event_id : Text,
    team_id : Text,
    stats : [Types.GamePlayerStatInput],
  ) : async { #Ok : [Types.GamePlayerStat]; #Err : Text } {
    auth(caller);
    if (not valid(event_id) or not valid(team_id)) return #Err("Invalid game player stats");
    if (not canManageTeamBoard(caller, team_id)) return #Err("Game stats management forbidden");
    let rows : [Types.GamePlayerStat] = stats.map(func(input) : Types.GamePlayerStat {
      {
        event_id; team_id;
        user_id = input.user_id;
        fill_in_player_name = input.fill_in_player_name;
        jersey_number = input.jersey_number;
        minutes_played = input.minutes_played;
        positions_played = input.positions_played;
        substitutions_count = input.substitutions_count;
        started_on_pitch = input.started_on_pitch;
        goals_scored = input.goals_scored;
      }
    });
    gamePlayerStats := gamePlayerStats.filter(func(item) = item.event_id != event_id).concat(rows);
    #Ok(rows)
  };

  public query ({ caller }) func list_game_player_stats(event_id : Text) : async { #Ok : [Types.GamePlayerStat]; #Err : Text } {
    auth(caller);
    #Ok(gamePlayerStats.filter(func(item) = item.event_id == event_id))
  };

  // ---- Workstream D: cross-sport game result (upsert by event_id) ----
  public shared ({ caller }) func save_game_result(
    team_id : Text,
    event_id : ?Text,
    sport : Text,
    home_label : Text,
    away_label : Text,
    home_score : Nat32,
    away_score : Nat32,
    period_scores_json : Text,
    player_stats_json : Text,
    mvp_player_id : ?Text,
    mvp_player_name : ?Text,
  ) : async { #Ok : Types.GameResult; #Err : Text } {
    auth(caller);
    if (not valid(team_id) or not valid(sport)) return #Err("Invalid game result");
    if (not canManageTeamBoard(caller, team_id)) return #Err("Game result management forbidden");
    let existing = switch (event_id) {
      case (?id) gameResults.find(func(item) = item.event_id == ?id);
      case null null;
    };
    let value : Types.GameResult = {
      id = switch (existing) { case (?e) e.id; case null "gr-" # team_id # "-" # Nat.toText(gameResults.size()) };
      team_id; event_id; sport; home_label; away_label; home_score; away_score;
      period_scores_json; player_stats_json; mvp_player_id; mvp_player_name;
      saved_by = caller; updated_at_ms = nowMs();
    };
    gameResults := switch (event_id) {
      case (?id) gameResults.filter(func(item) = item.event_id != ?id).concat([value]);
      case null gameResults.concat([value]);
    };
    #Ok(value)
  };

  public query ({ caller }) func get_game_result(event_id : Text) : async { #Ok : ?Types.GameResult; #Err : Text } {
    auth(caller);
    #Ok(gameResults.find(func(item) = item.event_id == ?event_id))
  };

  // ---- Workstream D: active game mirror (server-side push notification driver) ----
  // Shared-session model (mirrors Supabase active_games): one active row per
  // team; a null team scopes the row to the caller alone.
  public shared ({ caller }) func sync_active_game(
    team_id : ?Text,
    timer_state_json : Text,
    pitch_state_json : Text,
    board_session_id : Text,
  ) : async { #Ok : Types.ActiveGame; #Err : Text } {
    auth(caller);
    let matches = func(item : Types.ActiveGame) : Bool {
      item.is_active and (switch (team_id) { case (?t) item.team_id == ?t; case null item.user_id.equal(caller) and item.team_id == null })
    };
    let existing = activeGames.find(matches);
    let value : Types.ActiveGame = {
      id = switch (existing) { case (?e) e.id; case null "ag-" # Principal.toText(caller) # "-" # Nat.toText(activeGames.size()) };
      user_id = caller; team_id; timer_state_json; pitch_state_json; board_session_id; is_active = true; updated_at_ms = nowMs();
    };
    activeGames := activeGames.filter(func(item) = not matches(item)).concat([value]);
    #Ok(value)
  };

  public shared ({ caller }) func deactivate_active_game(team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    activeGames := activeGames.map(func(item) : Types.ActiveGame {
      let owns = switch (team_id) { case (?t) item.team_id == ?t; case null item.user_id.equal(caller) and item.team_id == null };
      if (owns and item.is_active) { { item with is_active = false } } else { item }
    });
    #Ok
  };

  public query ({ caller }) func get_active_game(team_id : ?Text) : async { #Ok : ?Types.ActiveGame; #Err : Text } {
    auth(caller);
    #Ok(activeGames.find(func(item) = item.is_active and (switch (team_id) { case (?t) item.team_id == ?t; case null item.user_id.equal(caller) and item.team_id == null })))
  };

  // ---- Workstream D: admin per-viewer event-view list + per-user viewed-ids ----
  public query ({ caller }) func list_event_views(event_id : Text) : async { #Ok : [Types.EventView]; #Err : Text } {
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(eventViews.filter(func(item) = item.event_id == event_id));
    }
  };

  public query ({ caller }) func list_my_viewed_event_ids(event_ids : [Text]) : async { #Ok : [Text]; #Err : Text } {
    auth(caller);
    #Ok(event_ids.filter(func(id) = eventViews.any(func(item) = item.event_id == id and item.viewer.equal(caller))))
  };

  // ---- Workstream D: event membership check ----
  // events_domain has no user_roles/children/child_guardians membership
  // tables (those live in club_domain, owned by another agent) — evaluated
  // here against the membership signals events_domain CAN reach: the
  // account's own roster/rsvp/attendance/duty rows for this event, plus any
  // mini-league-player RSVP the account is linked to via the same account id.
  // RESIDUAL LIMITATION: a parent/guardian whose ONLY link to the event is
  // via a child record owned by club_domain (child_guardians) will read as
  // not-a-member here; see frontend/roadmap.md.
  public query ({ caller = _ }) func check_event_membership(user_id : Text, event_id : Text) : async Bool {
    if (not valid(user_id) or not valid(event_id)) return false;
    let onRoster = roster.any(func(item) = item.event_id == event_id and item.account_id == user_id);
    if (onRoster) return true;
    let hasRsvp = rsvps.any(func(item) = item.event_id == event_id and item.account_id == user_id);
    if (hasRsvp) return true;
    let hasAttendance = attendance.any(func(item) = item.event_id == event_id and item.account_id == user_id);
    if (hasAttendance) return true;
    let hasEventAttendance = eventAttendance.any(func(item) = item.event_id == event_id and item.subject_id == user_id);
    if (hasEventAttendance) return true;
    let hasDuty = duties.any(func(item) = item.event_id == event_id and item.account_id == user_id);
    if (hasDuty) return true;
    false
  };

  // ===================== Workstream G: PlayHQ reads (HTTPS outcall) =====================
  // Governor-set config holding the scoped PlayHQ API key — node providers
  // can read canister state, so only ever store a limited/scoped key here.
  // Import/materialise-team-events remains Supabase-only (previously
  // decided); these are read-only competition/fixture lookups mirroring
  // PlayHQTeamLinkCard's Supabase queries.
  public shared ({ caller }) func set_playhq_config(config : ?Types.PlayHQConfig) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    switch (config) {
      case (?c) {
        if (not Text.startsWith(c.base_url, #text "https://") or c.base_url.size() > 2048) return #Err("Base URL must be a public https:// URL");
        if (c.api_key == "") return #Err("Invalid PlayHQ config");
      };
      case null {};
    };
    playHQConfig := config;
    #Ok
  };

  public query func playhqTransform({
    context : Blob;
    response : IC.HttpRequestResult;
  }) : async IC.HttpRequestResult {
    { response with headers = [] };
  };

  // Tolerant flat-object JSON helpers. There is no JSON library in this
  // repo's mops deps; rather than hand-roll a full recursive-descent parser,
  // these extract only the fields PlayHQTeamLinkCard actually displays
  // (competition id/name/season name, fixture team ids/names). See
  // frontend/roadmap.md for the documented limitation: deeply nested or
  // differently-shaped PlayHQ payloads may yield partial/empty results
  // rather than a hard parse error.
  func findJsonStringValue(body : Text, key : Text) : ?Text {
    let needle = "\"" # key # "\"";
    let parts = Text.toArray(body);
    let n = Text.toArray(needle);
    let size = parts.size();
    var i = 0;
    label search while (i + n.size() < size) {
      var matched = true;
      var j = 0;
      while (j < n.size()) {
        if (parts[i + j] != n[j]) { matched := false; j := n.size() } else { j += 1 };
      };
      if (matched) {
        var k = i + n.size();
        while (k < size and parts[k] != '\u{22}') {
          if (parts[k] == '}' or parts[k] == ',') { return null };
          k += 1;
        };
        if (k >= size) return null;
        k += 1;
        var value = "";
        var escaped = false;
        label read while (k < size) {
          let c = parts[k];
          if (escaped) {
            value := value # (switch (c) { case ('n') { "\n" }; case ('t') { "\t" }; case ('r') { "\r" }; case (_) { Text.fromArray([c]) } });
            escaped := false;
          } else if (c == '\\') {
            escaped := true;
          } else if (c == '\u{22}') {
            return ?value;
          } else {
            value := value # Text.fromArray([c]);
          };
          k += 1;
        };
        return null;
      };
      i += 1;
    };
    null
  };

  // Finds `"key":[` then balances brackets to return the raw array body
  // (without the surrounding `[`/`]`). Returns "" if not found.
  func extractJsonArray(body : Text, key : Text) : Text {
    let needle = "\"" # key # "\":[";
    let parts = Text.toArray(body);
    let n = Text.toArray(needle);
    let size = parts.size();
    var i = 0;
    label search while (i + n.size() <= size) {
      var matched = true;
      var j = 0;
      while (j < n.size()) {
        if (parts[i + j] != n[j]) { matched := false; j := n.size() } else { j += 1 };
      };
      if (matched) {
        var depth = 1;
        var k = i + n.size();
        let start = k;
        while (k < size and depth > 0) {
          if (parts[k] == '[') { depth += 1 } else if (parts[k] == ']') { depth -= 1 };
          if (depth > 0) { k += 1 };
        };
        return Text.fromArray(Array.tabulate<Char>(k - start, func(idx) = parts[start + idx]));
      };
      i += 1;
    };
    ""
  };

  // Splits a JSON array body (as returned by extractJsonArray) into the raw
  // text of each top-level `{...}` object, ignoring nested braces.
  func splitJsonObjects(arrText : Text) : [Text] {
    let parts = Text.toArray(arrText);
    let size = parts.size();
    var objects : [Text] = [];
    var i = 0;
    while (i < size) {
      if (parts[i] == '{') {
        var depth = 1;
        let start = i;
        var k = i + 1;
        while (k < size and depth > 0) {
          if (parts[k] == '{') { depth += 1 } else if (parts[k] == '}') { depth -= 1 };
          k += 1;
        };
        objects := objects.concat([Text.fromArray(Array.tabulate<Char>(k - start, func(idx) = parts[start + idx]))]);
        i := k;
      } else {
        i += 1;
      };
    };
    objects
  };

  // Finds `"key":{...}` and returns the raw object text (with braces), or
  // "" if not found. Used to reach into PlayHQ's nested `season` object.
  func extractJsonObject(body : Text, key : Text) : Text {
    let needle = "\"" # key # "\":{";
    let parts = Text.toArray(body);
    let n = Text.toArray(needle);
    let size = parts.size();
    var i = 0;
    label search while (i + n.size() <= size) {
      var matched = true;
      var j = 0;
      while (j < n.size()) {
        if (parts[i + j] != n[j]) { matched := false; j := n.size() } else { j += 1 };
      };
      if (matched) {
        var depth = 1;
        let start = i + n.size() - 1;
        var k = i + n.size();
        while (k < size and depth > 0) {
          if (parts[k] == '{') { depth += 1 } else if (parts[k] == '}') { depth -= 1 };
          k += 1;
        };
        return Text.fromArray(Array.tabulate<Char>(k - start, func(idx) = parts[start + idx]));
      };
      i += 1;
    };
    ""
  };

  func playhqHttpGet(path : Text) : async* { #Ok : Text; #Err : Text } {
    let config = switch (playHQConfig) {
      case null { return #Err("PlayHQ not configured") };
      case (?c) { c };
    };
    let request : IC.HttpRequestArgs = {
      url = config.base_url # path;
      max_response_bytes = ?(2_000_000 : Nat64);
      headers = [
        { name = "x-api-key"; value = config.api_key },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = ?{ function = playhqTransform; context = Blob.fromArray([]) };
      // Non-replicated: a GET against a third-party read API, avoiding ~13x
      // duplicate charges per call across subnet nodes (see messaging_domain
      // generate_chat_recap for the same reasoning).
      is_replicated = ?false;
    };
    try {
      let response = await Call.httpRequest(request);
      if (response.status < 200 or response.status >= 300) {
        return #Err("PlayHQ returned status " # Nat.toText(response.status));
      };
      switch (Text.decodeUtf8(response.body)) {
        case (?t) { #Ok(t) };
        case null { #Err("PlayHQ response was not valid UTF-8") };
      }
    } catch (e) {
      #Err("PlayHQ request failed: " # Error.message(e))
    }
  };

  // Mirrors PlayHQTeamLinkCard's Supabase `competitions` read: id/name/season
  // for the tenant+org the club has configured (club_domain owns those two
  // values; the frontend passes them straight through).
  public shared ({ caller }) func list_playhq_competitions(tenant : Text, org_id : Text) : async { #Ok : [Types.PlayHQCompetition]; #Err : Text } {
    auth(caller);
    if (not valid(tenant) or not valid(org_id)) return #Err("Invalid tenant/org");
    switch (await* playhqHttpGet("/v1/" # tenant # "/organisations/" # org_id # "/competitions")) {
      case (#Err(e)) #Err(e);
      case (#Ok(bodyText)) {
        let arr = extractJsonArray(bodyText, "competitions");
        let objs = splitJsonObjects(if (arr == "") bodyText else arr);
        #Ok(Array.map<Text, Types.PlayHQCompetition>(objs, func(obj) {
          let id = switch (findJsonStringValue(obj, "id")) { case (?v) v; case null "" };
          let name = switch (findJsonStringValue(obj, "name")) { case (?v) v; case null "" };
          let seasonObj = extractJsonObject(obj, "season");
          let season = if (seasonObj == "") null else findJsonStringValue(seasonObj, "name");
          { id; name; season }
        }))
      };
    }
  };

  // Mirrors PlayHQTeamLinkCard's Supabase `competition_matches` read: the
  // external home/away team ids + names for a given competition's fixture.
  public shared ({ caller }) func list_playhq_fixtures(competition_id : Text) : async { #Ok : [Types.PlayHQMatch]; #Err : Text } {
    auth(caller);
    if (not valid(competition_id)) return #Err("Invalid competition id");
    switch (await* playhqHttpGet("/v1/competitions/" # competition_id # "/fixture")) {
      case (#Err(e)) #Err(e);
      case (#Ok(bodyText)) {
        let arr = extractJsonArray(bodyText, "matches");
        let objs = splitJsonObjects(if (arr == "") bodyText else arr);
        #Ok(Array.map<Text, Types.PlayHQMatch>(objs, func(obj) {
          let homeObj = extractJsonObject(obj, "homeTeam");
          let awayObj = extractJsonObject(obj, "awayTeam");
          {
            external_home_team_id = if (homeObj == "") null else findJsonStringValue(homeObj, "id");
            external_away_team_id = if (awayObj == "") null else findJsonStringValue(awayObj, "id");
            home_team_name = if (homeObj == "") null else findJsonStringValue(homeObj, "name");
            away_team_name = if (awayObj == "") null else findJsonStringValue(awayObj, "name");
          }
        }))
      };
    }
  };

  // ---- Event reminder fan-out (non-RSVP member-list notify) ----
  // Verifies the caller manages the event, computes recipients as the event
  // audience (club/team members) minus accounts who already have an RSVP,
  // mirroring the Supabase useEventReminderMutations non-responder branch,
  // then enqueues via notification_queue (fire-and-forget, fail-closed while
  // unset) — mirrors club_domain.send_fee_reminders / messaging_domain's chat
  // notify fan-out. Push delivery itself stays Supabase-side by design.
  public shared ({ caller }) func set_notification_queue_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    notificationQueueCanister := ?id;
    #Ok
  };

  // ---- club_domain permanent-delete fan-out ----
  public shared ({ caller }) func set_club_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    clubDomainCanister := ?id;
    #Ok
  };

  // Removes every event, series, RSVP, attendance, duty, roster, lineup,
  // game, and training-pause record in scope. `club` additionally clears
  // club-keyed state (series, training pauses, child team assignments);
  // `doomedTeams` clears team-keyed state (game data, pitch boards, active
  // games). Returns the number of events removed.
  func purgeScope(isDoomedEvent : (Types.Event) -> Bool, doomedTeams : [Text], club : ?Text) : Nat32 {
    let doomedIds = events.filter(isDoomedEvent).map(func(e) = e.id);
    func inDoomed(eventId : Text) : Bool { doomedIds.any(func(d) = d == eventId) };
    func inDoomedTeam(teamId : Text) : Bool { doomedTeams.any(func(d) = d == teamId) };
    func inClub(value : Text) : Bool { switch (club) { case (?c) { value == c }; case null { false } } };
    let doomedGroupIds = eventGroups.filter(func(g) = inDoomed(g.event_id)).map(func(g) = g.id);
    func inDoomedGroup(groupId : Text) : Bool { doomedGroupIds.any(func(d) = d == groupId) };
    events := events.filter(func(e) = not inDoomed(e.id));
    series := series.filter(func(s) = not inClub(s.club_id) and (switch (s.team_id) { case (?t) { not inDoomedTeam(t) }; case null { true } }));
    rsvps := rsvps.filter(func(r) = not inDoomed(r.event_id));
    attendance := attendance.filter(func(a) = not inDoomed(a.event_id));
    lineups := lineups.filter(func(l) = not inDoomed(l.event_id));
    lineupSnapshots := lineupSnapshots.filter(func(l) = not inDoomed(l.event_id));
    duties := duties.filter(func(d) = not inDoomed(d.event_id));
    roster := roster.filter(func(r) = not inDoomed(r.event_id));
    recurrences := recurrences.filter(func(r) = not inDoomed(r.event_id));
    eventAttendance := eventAttendance.filter(func(a) = not inDoomed(a.event_id));
    eventGuests := eventGuests.filter(func(g) = not inDoomed(g.event_id));
    coachNotes := coachNotes.filter(func(n) = not inDoomed(n.event_id));
    eventViews := eventViews.filter(func(v) = not inDoomed(v.event_id));
    reminderLogs := reminderLogs.filter(func(l) = not inDoomed(l.event_id));
    openDuties := openDuties.filter(func(d) = not inDoomed(d.event_id));
    miniLeagueRsvps := miniLeagueRsvps.filter(func(r) = not inDoomed(r.event_id));
    eventGroups := eventGroups.filter(func(g) = not inDoomed(g.event_id));
    eventGroupPlayers := eventGroupPlayers.filter(func(p) = not inDoomedGroup(p.group_id));
    eventGroupDuties := eventGroupDuties.filter(func(d) = not inDoomedGroup(d.group_id));
    gameSummaries := gameSummaries.filter(func(g) = not inDoomed(g.event_id) and not inDoomedTeam(g.team_id));
    gamePlayerStats := gamePlayerStats.filter(func(g) = not inDoomed(g.event_id) and not inDoomedTeam(g.team_id));
    gameResults := gameResults.filter(func(g) = (switch (g.event_id) { case (?e) { not inDoomed(e) }; case null { true } }) and not inDoomedTeam(g.team_id));
    activeGames := activeGames.filter(func(g) = switch (g.team_id) { case (?t) { not inDoomedTeam(t) }; case null { true } });
    pitchBoardSettings := pitchBoardSettings.filter(func(s) = not inDoomedTeam(s.team_id));
    teamTrainingPauses := teamTrainingPauses.filter(func(p) = not inClub(p.club_id) and not inDoomedTeam(p.team_id));
    childTeamAssignments := childTeamAssignments.filter(func(a) = not inClub(a.club_id) and not inDoomedTeam(a.team_id));
    Nat.toNat32(doomedIds.size())
  };

  // Called by club_domain when a club is permanently deleted (manually or
  // by the 30-day auto-purge). Only the configured club_domain canister may
  // call; fail-closed while unset.
  public shared ({ caller }) func delete_club_data(club_id : Text) : async { #Ok : Nat32; #Err : Text } {
    switch (clubDomainCanister) {
      case null { return #Err("club_domain canister not configured") };
      case (?c) { if (not c.equal(caller)) return #Err("club_domain only") };
    };
    // Team-keyed state has no club column, so derive the club's team ids
    // from the records that do carry one.
    var teamIds : [Text] = [];
    func noteTeam(teamId : Text) { if (not teamIds.any(func(t) = t == teamId)) teamIds := teamIds.concat([teamId]) };
    for (e in events.values()) { if (e.club_id == club_id) { switch (e.team_id) { case (?t) noteTeam(t); case null {} } } };
    for (a in childTeamAssignments.values()) { if (a.club_id == club_id) noteTeam(a.team_id) };
    for (p in teamTrainingPauses.values()) { if (p.club_id == club_id) noteTeam(p.team_id) };
    #Ok(purgeScope(func(e) = e.club_id == club_id, teamIds, ?club_id))
  };

  // Called by club_domain when a single team is permanently deleted.
  public shared ({ caller }) func delete_team_data(team_id : Text) : async { #Ok : Nat32; #Err : Text } {
    switch (clubDomainCanister) {
      case null { return #Err("club_domain canister not configured") };
      case (?c) { if (not c.equal(caller)) return #Err("club_domain only") };
    };
    #Ok(purgeScope(func(e) = e.team_id == ?team_id, [team_id], null))
  };

  public shared ({ caller }) func send_event_reminders(event_id : Text) : async { #Ok : Nat16; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(event)) { await fanOutReminder(event) };
    };
  };

  func fanOutReminder(event : Types.Event) : async { #Ok : Nat16; #Err : Text } {
    let event_id = event.id;
    do {
      do {
        switch (notificationQueueCanister) {
          case null { #Err("Notification queue not configured") };
          case (?nq) {
            let responded = rsvps.filter(func(item) = item.event_id == event_id).map(func(item) = item.account_id);
            var recipients : [Text] = [];
            for (grant in roles.values()) {
              if (grant.club_id == event.club_id and (grant.team_id == event.team_id or grant.team_id == null) and recipients.size() < 500) {
                let accountId = grant.user.toText();
                if (responded.find(func(r) = r == accountId) == null and recipients.find(func(r) = r == accountId) == null) {
                  recipients := recipients.concat([accountId]);
                };
              };
            };
            if (recipients.size() == 0) return #Ok(0);
            let queue : actor {
              fan_out : shared ([Text], Text, Text, Text, Text, ?Text) -> async { #Ok : Nat16; #Err : Text };
            } = actor (Principal.toText(nq));
            let keyPrefix = "event-reminder-" # event_id # "-" # Nat64.toText(nowMs());
            try {
              await queue.fan_out(recipients, event.club_id, "event_reminder", "Reminder: Please RSVP for \"" # event.title # "\"", keyPrefix, ?event_id)
            } catch (_) { #Err("Notification queue call failed") }
          };
        };
      };
    };
  };

  // ---- Scheduled (auto) RSVP reminders ----
  public shared ({ caller }) func set_event_auto_reminder(event_id : Text, hours_before : ?Nat16) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_)) {};
    };
    let existing = autoReminders.find(func(r) = r.event_id == event_id);
    let rest = autoReminders.filter(func(r) = r.event_id != event_id);
    switch (hours_before) {
      case null { autoReminders := rest };
      case (?h) {
        if (h == 0 or h > 720) return #Err("Invalid reminder time");
        let sent = switch (existing) { case (?e) e.sent and e.hours_before == h; case null false };
        autoReminders := rest.concat([{ event_id; hours_before = h; sent }]);
      };
    };
    #Ok
  };

  public query ({ caller }) func get_event_auto_reminder(event_id : Text) : async ?{ hours_before : Nat16; sent : Bool } {
    switch (events.find(func(e) = e.id == event_id)) {
      case null null;
      case (?event) {
        if (not canView(caller, event)) return null;
        switch (autoReminders.find(func(r) = r.event_id == event_id)) {
          case null null;
          case (?r) ?{ hours_before = r.hours_before; sent = r.sent };
        }
      };
    }
  };

  // Cancels (or reinstates) every non-deleted occurrence in a series that
  // starts at or after from_ms, in one atomic canister call.
  public shared ({ caller }) func set_series_cancelled(series_id : Text, cancelled : Bool, from_ms : Nat64) : async { #Ok : Nat32; #Err : Text } {
    auth(caller);
    switch (requireManageSeries(caller, series_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_)) {};
    };
    var count : Nat32 = 0;
    let now = nowMs();
    events := events.map(func(e) {
      if (e.series_id == ?series_id and not e.deleted and e.starts_at_ms >= from_ms and e.cancelled != cancelled) {
        count += 1;
        let u : Types.Event = { e with cancelled; revision = e.revision + 1; updated_at_ms = now };
        u
      } else e
    });
    #Ok(count)
  };

  func sweepAutoReminders() : async () {
    let now = nowMs();
    for (r in autoReminders.values()) {
      if (not r.sent) {
        switch (events.find(func(e) = e.id == r.event_id)) {
          case null {};
          case (?event) {
            let dueAt : Nat64 = if (event.starts_at_ms > Nat64.fromNat(r.hours_before.toNat()) * 3_600_000) event.starts_at_ms - Nat64.fromNat(r.hours_before.toNat()) * 3_600_000 else 0;
            if (event.deleted or event.cancelled or event.starts_at_ms <= now) {
              markReminderSent(r.event_id);
            } else if (now >= dueAt) {
              switch (await fanOutReminder(event)) {
                case (#Ok(_)) markReminderSent(r.event_id);
                case (#Err(_)) {};
              };
            };
          };
        };
      };
    };
  };

  func markReminderSent(event_id : Text) {
    autoReminders := autoReminders.map(func(r) { if (r.event_id == event_id) { { r with sent = true } } else r });
  };

  transient let _reminderTimer = Timer.recurringTimer<system>(#seconds(900), func() : async () { await sweepAutoReminders() });

  public query ({ caller }) func export_state() : async { #Ok : { schema : Nat32; governor : Principal; roles : [Types.RoleGrant]; events : [Types.Event]; rsvps : [Types.Rsvp]; attendance : [Types.Attendance]; lineups : [Types.LineupEntry]; lineupSnapshots : [Types.LineupSnapshot]; duties : [Types.Duty]; roster : [Types.RosterEntry]; recurrences : [Types.Recurrence]; series : [Types.EventSeries]; eventAttendance : [Types.EventAttendance]; eventGuests : [Types.EventGuest]; children : [Types.Child]; childGuardians : [Types.ChildGuardian]; coachNotes : [Types.CoachNote]; eventViews : [Types.EventView]; reminderLogs : [Types.ReminderLog]; pushReachability : [Types.PushReachability]; eventGroups : [Types.EventGroup]; eventGroupPlayers : [Types.EventGroupPlayer]; eventGroupDuties : [Types.EventGroupDuty]; teamTrainingPauses : [Types.TeamTrainingPause]; openDuties : [Types.OpenDuty]; miniLeagueRsvps : [Types.MiniLeagueRsvp]; childTeamAssignments : [Types.ChildTeamAssignment] }; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    #Ok({ schema = 5; governor; roles; events; rsvps; attendance; lineups; lineupSnapshots; duties; roster; recurrences; series; eventAttendance; eventGuests; children; childGuardians; coachNotes; eventViews; reminderLogs; pushReachability; eventGroups; eventGroupPlayers; eventGroupDuties; teamTrainingPauses; openDuties; miniLeagueRsvps; childTeamAssignments })
  };
};