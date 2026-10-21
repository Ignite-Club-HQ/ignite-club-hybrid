import AccountAdmission "../../shared/AccountAdmission";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import RemovalEndpoints "../../shared/RemovalEndpoints";
import Map "mo:core/Map";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Option "mo:core/Option";
import Json "mo:json";
import Nat32 "mo:core/Nat32";
import Nat16 "mo:core/Nat16";
import Nat64 "mo:core/Nat64";
import Int64 "mo:core/Int64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Error "mo:core/Error";
import Timer "mo:core/Timer";
import Call "mo:ic/Call";
import IC "mo:ic/Types";
import Types "types";
import Oql "../../shared/Oql";
import OqlEvents "oqlEvents";
import HistoryPrivacy "historyPrivacy";
import PlayhqFeed "playhqFeed";

persistent actor class Main(governorInit : Principal) = this {
  // Local rehearsal only. Eligibility never grants resource permissions.
  transient let accountAdmissionEnabled = Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == ?"1";
  transient let accountAdmissionAuthority = switch (Runtime.envVar<system>("IGNITE_ACCOUNT_SERVICE_IDENTITY")) {
    case (?id) ?Principal.fromText(id); case null null
  };
  transient let accountAdmission = AccountAdmission.Gate(accountAdmissionEnabled, accountAdmissionAuthority);
  var removal_intents : Map.Map<Text, RemovalReceiver.Request>;
  var removal_subjects : Map.Map<Principal, Text>;
  var removal_active : Map.Map<Principal, Nat>;
  transient let removalReceiver = RemovalReceiver.Gate(accountAdmissionEnabled, accountAdmissionAuthority, removal_intents, removal_subjects, removal_active);
  include RemovalEndpoints(removalReceiver, Principal.fromActor(this), func _ = 0);
  func admitAccount(subject : Principal) : async () {
    if (removalReceiver.denied(subject)) throw Error.reject("Account removal fenced");
    let eligible = await accountAdmission.eligible(subject);
    if (removalReceiver.denied(subject) or not eligible) throw Error.reject("Account admission denied or unavailable");
  };
  func denyLegacyAccountQuery() {
    if (accountAdmissionEnabled) Runtime.trap("Use protected consensus account read");
  };
  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };
  public shared ({ caller }) func read_group_opening_configuration() : async [(Text, Text)] {
    if (not isGovernor(caller)) Runtime.trap("Governor required");
    [("club_domain", OpeningConfiguration.optional(clubDomainCanister)),
     ("notification_queue", OpeningConfiguration.optional(notificationQueueCanister)),
     ("mini_league_domain", OpeningConfiguration.optional(miniLeagueDomainCanister)),
     ("competition_domain", OpeningConfiguration.optional(competitionDomainCanister))]
  };

  // ICP MCP Layer 3: behavioral guide for AI agents (see
  // docs.internetcomputer.org/guides/frontends/service-discoverability).
  public query func getApiDoc() : async Text {
    "# events_domain — club/team events, RSVPs, attendance, fixtures\n\n" #
    "## Authentication\n" #
    "All methods require a signed (non-anonymous) principal. The caller's principal is resolved to an app account; event visibility is limited to the event's governor, its creator, and members of the owning club. You can only ever see events for clubs the signed-in user belongs to.\n\n" #
    "## Key reads (queries)\n" #
    "- `schema()` documents read-only OQL events and its JSON dialect; `execute(json)` filters, sorts, projects, counts and pages caller-visible, non-deleted events. Obtain Internet Identity delegation first. Invalid queries trap. No writes or PII decryption.\n" #
    "- `list_events(club_id:?text, team_id:?text)` / `list_events_multi(club_ids:vec text, team_ids:vec text)`: accept club/team filters, not dates. Use execute with starts_at_ms filters for upcoming events. Timestamps are Unix milliseconds.\n" #
    "- `get_event_roster(event_id)`: RSVPs/attendance for an event.\n" #
    "- `get_event_timer(event_id)`: countdown/timer state for an event.\n" #
    "- `list_playhq_fixtures(...)` is an UPDATE call (not a query): it fetches external fixture data and may take several seconds.\n\n" #
    "## Writes\n" #
    "Creating/updating events requires a coach, team-admin, or club-admin role in the owning club; the canister re-checks roles on every call. RSVPs are per-account and idempotent by event+account. Monthly recurrence clamps to the last day of shorter months, in UTC.\n\n" #
    "## Gotchas\n" #
    "- All timestamps are milliseconds (not seconds, not nanoseconds).\n" #
    "- Omitting an option field on update keeps the stored value; passing an explicit empty value clears it.\n" #
    "- Denied calls return `#Err(\"...\")` rather than trapping, except anonymous callers, which trap with `Forbidden`."
  };
  public query func schema() : async Text {
    Oql.schema([OqlEvents.entity], "{\"entity\":\"events\",\"filters\":[{\"field\":\"starts_at_ms\",\"op\":\"gte\",\"value\":1792285200000},{\"field\":\"cancelled\",\"op\":\"eq\",\"value\":false}],\"orderBy\":{\"field\":\"starts_at_ms\",\"direction\":\"asc\"},\"limit\":50}")
  };
  public query ({ caller }) func execute(input : Text) : async Oql.Result {
    denyLegacyAccountQuery();
    auth(caller);
    let request = Oql.parse(input, [OqlEvents.entity]);
    Oql.run<Types.Event>(request, events, func(event) = not event.deleted and canView(caller, event), OqlEvents.row)
  };
  // Live memory reading for the admin health page (public, like cycles_balance).
  public query func memory_stats() : async { heap_bytes : Nat; memory_bytes : Nat; stable_bytes : Nat } {
    {
      heap_bytes = PrimMem.rts_heap_size();
      memory_bytes = PrimMem.rts_memory_size();
      stable_bytes = PrimMem.nat64ToNat(PrimMem.stableMemorySize()) * 65536;
    }
  };

  /// Public: aggregate record counts (shown in admin settings). Counts only —
  /// no record contents, so no PII is exposed.
  public query func usage_stats() : async { events : Nat; rsvps : Nat; children : Nat } {
    { events = events.size(); rsvps = rsvps.size(); children = children.size() };
  };

  var governor : Principal;
  var transferFences : [Text];

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
  var eventSponsors : [(Text, [Text])];
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
  var playhqTeamSyncs : [Types.PlayHQTeamSync];
  var playhqEventLinks : [Types.PlayHQEventLink];
  // Governor-set notification_queue canister id for the event-reminder
  // fan-out hook. Fail-closed while unset, mirrors messaging_domain/club_domain.
  var notificationQueueCanister : ?Principal;
  // Governor-set club_domain canister id for the permanent-delete fan-out.
  // Fail-closed while unset: delete_club_data/delete_team_data reject every
  // caller until the deploy script wires this.
  var clubDomainCanister : ?Principal;
  var miniLeagueDomainCanister : ?Principal;
  // Scheduled RSVP reminders (hours before start); swept by _reminderTimer.
  var autoReminders : [{ event_id : Text; hours_before : Nat16; sent : Bool }];
  var eventDutyTeams : [Types.EventDutyTeam];
  var dutyTeamReminderSent : [Text];
  var pointsReminderSent : [Text];
  var individualDutyReminderSent : [Text];
  var competitionDomainCanister : ?Principal;
  var competitionEventOperations : [Types.CompetitionEventOperation];
  var competitionMatchLinks : [Types.CompetitionEventLink];
  // Per-caller favourite event titles / saved locations / training defaults /
  // RSVP created_at preservation (events UX extras, migration 20261015_000000).
  var favouriteEventTitles : [Types.FavouriteEventTitle];
  var savedLocations : [Types.SavedLocation];
  var trainingDefaults : [Types.TrainingDefault];
  var rsvpCreatedAt : [Types.RsvpCreatedAt];
  // Per-match captain/vice-captain + goalkeeper assignments (events_domain
  // extras, migration 20261015_000000).
  var matchCaptainAssignments : [Types.MatchCaptainAssignment];
  var matchGoalkeeperAssignments : [Types.MatchGoalkeeperAssignment];
  // Live match timer, one row per event (events_domain extras, migration
  // 20261016_000000). See Types.EventTimer.
  var eventTimers : [Types.EventTimer];
  // Game event ids that already received the post-game photo prompt
  // (migration 20261020_000000); swept by _reminderTimer.
  var photoPromptsSent : [Text];
  // Per-event sponsor links (event_id -> sponsor ids), set via
  // set_event_sponsors/get_event_sponsors (migration 20261023_000000).
  // (declared earlier alongside the other list vars; kept here as the single
  // source of truth for its migration note.)
  // Append-only recent-write log backing the admin "sync storm" rate view
  // (AdminActiveGamesPage): one entry per sync_active_game call, trimmed to
  // the last writeLogWindowMs() on every append so it stays bounded instead
  // of growing with total lifetime writes (migration 20261023_000000).
  var activeGameWriteLog : [(Text, Nat64)];

  // Bounded window for activeGameWriteLog (10 minutes) — trimmed on every
  // sync_active_game write so the log never grows with lifetime write count.
  func writeLogWindowMs() : Nat64 { 600_000 };
  func auth(caller : Principal) { if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required") };
  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };
  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };
  // Records the first-RSVP timestamp for (event_id, account_id) if absent;
  // no-op on later status changes so created_at_ms survives updates.
  func recordRsvpCreatedAt(event_id : Text, account_id : Text) {
    if (not rsvpCreatedAt.any(func(item) = item.event_id == event_id and item.account_id == account_id)) {
      rsvpCreatedAt := rsvpCreatedAt.concat([{ event_id; account_id; created_at_ms = nowMs() }]);
    };
  };
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
  func validRsvpAudience(value : ?Text) : Bool {
    switch (value) {
      case null true;
      case (?(audience)) audience == "players_only" or audience == "players_and_parents" or audience == "parents_only";
    }
  };
  func validRsvpPolicyLists(restricted : ?[Text], targets : ?[Text]) : Bool {
    let rolesValid = switch (restricted) { case null true; case (?values) values.size() <= 32 and values.all(valid) };
    let targetsValid = switch (targets) { case null true; case (?values) values.size() <= 500 and values.all(valid) };
    rolesValid and targetsValid
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
  // Mirrors frontend/src/lib/serverTimer.ts `TimerEvent`.
  func validTimerAction(value : Text) : Bool {
    value == "start_half" or value == "pause" or value == "resume" or value == "end_half" or
    value == "start_half_2" or value == "end_game" or value == "adjust" or value == "set_minutes" or
    value == "reset"
  };
  func defaultEventTimer(event_id : Text, minutes_per_half : Nat16, caller : Principal) : Types.EventTimer {
    {
      event_id; schema_version = 2; current_half = 1; minutes_per_half;
      half_started_at_ms = null; half_paused_at_ms = null; accumulated_pause_ms = 0;
      is_running = false; is_game_finished = false; half_ended_at_ms = null;
      last_event_at_ms = nowMs(); updated_by = caller;
    }
  };

  // ---- Club transfer fence + snapshot (governor-only operator tooling) ----
  // Hard checks on the main write paths; the ingress inspect gate is advisory.
  // The transfer runner re-digests before cutover to catch anything else.
  func isFenced(club : Text) : Bool = transferFences.any(func(c) = c == club);
  func eventFenced(id : Text) : Bool = transferFences.size() > 0 and events.any(func(e) = e.id == id and isFenced(e.club_id));
  func groupFenced(id : Text) : Bool = transferFences.size() > 0 and eventGroups.any(func(g) = g.id == id and eventFenced(g.event_id));
  func teamFenced(id : Text) : Bool = transferFences.size() > 0 and events.any(func(e) = e.team_id == ?id and isFenced(e.club_id));
  func seriesFenced(id : Text) : Bool = transferFences.size() > 0 and events.any(func(e) = e.series_id == ?id and isFenced(e.club_id));
  func blobContainsText(hay : Blob, needle : Text) : Bool {
    let h = Blob.toArray(hay); let n = Blob.toArray(needle.encodeUtf8());
    if (n.size() == 0 or n.size() > h.size()) return false;
    var i = 0;
    while (i + n.size() <= h.size()) { var j = 0; while (j < n.size() and h[i + j] == n[j]) j += 1; if (j == n.size()) return true; i += 1 };
    false
  };
  system func inspect({ caller : Principal; arg : Blob }) : Bool {
    if (transferFences.size() == 0 or isGovernor(caller)) return true;
    not transferFences.any(func(c) = blobContainsText(arg, c))
  };
  public shared ({ caller }) func set_transfer_fence(club : Text, fenced : Bool) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    transferFences := transferFences.filter(func(c) = c != club);
    if (fenced) transferFences := transferFences.concat([club]);
    #Ok
  };
  public shared ({ caller }) func purge_club_snapshot(club : Text) : async { #Ok : Nat; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before purge");
    let evs = events.filter(func(e) = e.club_id == club);
    rsvps := rsvps.filter(func(r) = not evs.any(func(e) = e.id == r.event_id));
    series := series.filter(func(x) = not evs.any(func(e) = e.series_id == ?x.id));
    events := events.filter(func(e) = e.club_id != club);
    let gids = eventGroups.filter(func(g) = evs.any(func(e) = e.id == g.event_id)).map(func(g) = g.id);
    eventGroups := eventGroups.filter(func(g) = not gids.any(func(id) = id == g.id));
    eventGroupPlayers := eventGroupPlayers.filter(func(p) = not gids.any(func(id) = id == p.group_id));
    eventGroupDuties := eventGroupDuties.filter(func(d) = not gids.any(func(id) = id == d.group_id));
    competitionMatchLinks:=competitionMatchLinks.filter(func(l)=not evs.any(func(e)=e.id==l.event_id));
    gameResults:=gameResults.filter(func(r)=not evs.any(func(e)=r.event_id==?e.id));
    gamePlayerStats:=gamePlayerStats.filter(func(r)=not evs.any(func(e)=r.event_id==e.id));
    gameSummaries:=gameSummaries.filter(func(r)=not evs.any(func(e)=r.event_id==e.id));
    competitionEventOperations:=competitionEventOperations.map(func(o)={o with event_ids=o.event_ids.filter(func(id)=not evs.any(func(e)=e.id==id))});
    #Ok(evs.size())
  };
  type EventsSnapshot = { events : [Types.Event]; rsvps : [Types.Rsvp]; series : [Types.EventSeries]; groups : ?[Types.EventGroup]; group_players : ?[Types.EventGroupPlayer]; group_duties : ?[Types.EventGroupDuty]; match_links : ?[Types.CompetitionEventLink]; operations : ?[Types.CompetitionEventOperation]; results : ?[Types.GameResult]; summaries : ?[Types.GameSummary]; stats : ?[Types.GamePlayerStat] };
  public query ({ caller }) func export_club_snapshot(club : Text) : async { #Ok : Blob; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before export");
    let evs = events.filter(func(e) = e.club_id == club);
    let snap : EventsSnapshot = { events = evs; rsvps = rsvps.filter(func(r) = evs.any(func(e) = e.id == r.event_id));
      series = series.filter(func(x) = evs.any(func(e) = e.series_id == ?x.id)); groups = ?eventGroups.filter(func(g) = evs.any(func(e) = e.id == g.event_id)); group_players = ?eventGroupPlayers.filter(func(p) = eventGroups.any(func(g) = g.id == p.group_id and evs.any(func(e) = e.id == g.event_id))); group_duties = ?eventGroupDuties.filter(func(d) = eventGroups.any(func(g) = g.id == d.group_id and evs.any(func(e) = e.id == g.event_id)));
      match_links=?competitionMatchLinks.filter(func(l)=evs.any(func(e)=e.id==l.event_id));
      operations=?competitionEventOperations.filter(func(o)=o.event_ids.any(func(id)=evs.any(func(e)=e.id==id))).map(func(o)={o with event_ids=o.event_ids.filter(func(id)=evs.any(func(e)=e.id==id))});
      results=?gameResults.filter(func(r)=evs.any(func(e)=r.event_id==?e.id));summaries=?gameSummaries.filter(func(r)=evs.any(func(e)=r.event_id==e.id));stats=?gamePlayerStats.filter(func(r)=evs.any(func(e)=r.event_id==e.id)) };
    #Ok(to_candid (snap))
  };
  public shared ({ caller }) func import_club_snapshot(club : Text, snapshot : Blob) : async { #Ok : Nat; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before import");
    let decoded : ?EventsSnapshot = from_candid (snapshot);
    let snap = switch (decoded) { case (?x) x; case null return #Err("Invalid snapshot") };
    if (removalReceiver.snapshotDenied(snapshot)) return #Err("Snapshot references fenced account");
    if (snap.events.any(func(e) = e.club_id != club) or snap.rsvps.any(func(r) = not snap.events.any(func(e) = e.id == r.event_id))) return #Err("Snapshot contains foreign records");
    if (snap.events.any(func(e) = events.any(func(x) = x.id == e.id and x.club_id != club))) return #Err("Snapshot id collides with another club");
    let incomingGroups = snap.groups ?? [];
    let incomingPlayers = snap.group_players ?? [];
    let incomingDuties = snap.group_duties ?? [];
    let incomingLinks=snap.match_links??[];let incomingResults=snap.results??[];let incomingSummaries=snap.summaries??[];let incomingStats=snap.stats??[];let incomingOperations=snap.operations??[];
    if(incomingLinks.any(func(l)=not snap.events.any(func(e)=e.id==l.event_id and e.team_id==?l.team_id)) or incomingResults.any(func(r)=not snap.events.any(func(e)=r.event_id==?e.id and e.team_id==?r.team_id)) or incomingStats.any(func(r)=not snap.events.any(func(e)=r.event_id==e.id and e.team_id==?r.team_id)) or incomingSummaries.any(func(r)=not snap.events.any(func(e)=r.event_id==e.id and e.team_id==?r.team_id)) or incomingOperations.any(func(o)=o.event_ids.any(func(id)=not snap.events.any(func(e)=e.id==id)))) return #Err("Foreign History snapshot records");
    if(incomingOperations.any(func(op)=competitionEventOperations.any(func(old)=old.operation_id==op.operation_id and old.competition_id!=op.competition_id))) return #Err("Competition operation collision");
    if (incomingGroups.any(func(g) = not snap.events.any(func(e) = e.id == g.event_id)) or incomingPlayers.any(func(p) = not incomingGroups.any(func(g) = g.id == p.group_id)) or incomingDuties.any(func(d) = not incomingGroups.any(func(g) = g.id == d.group_id))) return #Err("Snapshot contains foreign group records");
    if (incomingGroups.any(func(g) = eventGroups.any(func(x) = x.id == g.id and not events.any(func(e) = e.id == x.event_id and e.club_id == club)))) return #Err("Group id collides with another club");
    if (incomingDuties.any(func(d) = eventGroupDuties.any(func(x) = x.id == d.id and not events.any(func(e) = e.club_id == club and eventGroups.any(func(g) = g.id == x.group_id and g.event_id == e.id))))) return #Err("Duty id collides with another club");
    let oldGroups = eventGroups.filter(func(g) = events.any(func(e) = e.id == g.event_id and e.club_id == club)).map(func(g) = g.id);
    eventGroups := eventGroups.filter(func(g) = not oldGroups.any(func(id) = id == g.id)).concat(incomingGroups);
    eventGroupPlayers := eventGroupPlayers.filter(func(p) = not oldGroups.any(func(id) = id == p.group_id)).concat(incomingPlayers);
    eventGroupDuties := eventGroupDuties.filter(func(d) = not oldGroups.any(func(id) = id == d.group_id)).concat(incomingDuties);
    let ids = events.filter(func(e) = e.club_id == club).map(func(e) = e.id);
    competitionMatchLinks:=competitionMatchLinks.filter(func(l)=not ids.any(func(id)=id==l.event_id)).concat(incomingLinks);
    gameResults:=gameResults.filter(func(r)=not ids.any(func(id)=r.event_id==?id)).concat(incomingResults);
    gameSummaries:=gameSummaries.filter(func(r)=not ids.any(func(id)=r.event_id==id)).concat(incomingSummaries);
    gamePlayerStats:=gamePlayerStats.filter(func(r)=not ids.any(func(id)=r.event_id==id)).concat(incomingStats);
    for(op in incomingOperations.values()) {
      let old=competitionEventOperations.find(func(o)=o.operation_id==op.operation_id);
      if(switch(old){case(?o)o.competition_id!=op.competition_id;case null false}) return #Err("Competition operation collision");
      let kept=switch(old){case null [];case(?o)o.event_ids.filter(func(id)=not ids.any(func(oldId)=id==oldId))};
      competitionEventOperations:=competitionEventOperations.filter(func(o)=o.operation_id!=op.operation_id).concat([{op with event_ids=kept.concat(op.event_ids)}]);
    };
    rsvps := rsvps.filter(func(r) = not ids.any(func(i) = i == r.event_id)).concat(snap.rsvps);
    series := series.filter(func(x) = not snap.series.any(func(y) = y.id == x.id)).concat(snap.series);
    events := events.filter(func(e) = e.club_id != club).concat(snap.events);
    #Ok(snap.events.size() + snap.rsvps.size())
  };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  // Typed view of the club_domain app_admin query. Fail-closed while
  // clubDomainCanister is unset (set_club_domain_canister, governor-only).
  type ClubDomainRef = actor { is_app_admin : shared query (Principal) -> async Bool; read_account_is_app_admin : shared (Principal) -> async Bool };
  func clubDomainRef() : ?ClubDomainRef {
    switch (clubDomainCanister) {
      case null { null };
      case (?cd) { ?(actor (Principal.toText(cd)) : ClubDomainRef) };
    };
  };
  // Platform-only (governor or club_domain's app_admin grant) — used to gate
  // the admin active-games monitor (AdminActiveGamesPage), never a club role.
  func requireAppAdmin(caller : Principal) : async Bool {
    if (isGovernor(caller)) return true;
    switch (clubDomainRef()) {
      case null { false };
      case (?cd) { try { if (accountAdmissionEnabled) await cd.read_account_is_app_admin(caller) else await cd.is_app_admin(caller) } catch (_) { false } };
    };
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
    OqlEvents.canView(caller, governor, roles, event)
  };
  // Live league authority, no browser grants or persistent membership mirrors.
  // Only the linked league in this club can authorize additional match viewers.
  func canViewMatch(caller : Principal, event : Types.Event) : async* Bool {
    if (Principal.isAnonymous(caller) or event.deleted) return false;
    if (canView(caller, event)) return true;
    let leagueId = switch (event.mini_league_id) { case null return false; case (?id) id };
    let authority = switch (miniLeagueDomainCanister) { case null return false; case (?id) id };
    let ml : actor { read_can_read_league_matches : shared (Principal, Text, Text) -> async Bool } = actor (authority.toText());
    try { await (with timeout = 10) ml.read_can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
  };
  func roleInEventScope(caller : Principal, event : Types.Event, allowedRoles : [Text]) : Bool {
    let targets = event.target_team_ids ?? [];
    roles.any(func(grant) =
      grant.user.equal(caller) and grant.club_id == event.club_id and
      allowedRoles.any(func(role) = role == grant.role) and
      (switch (event.team_id) {
        case (?team) { grant.team_id == ?team or grant.team_id == null };
        case null {
          if (targets.size() == 0) true else
            switch (grant.team_id) {
              case (?team) targets.any(func(target) = target == team);
              case null true;
            }
        };
      })
    )
  };
  func canSelfRsvp(caller : Principal, event : Types.Event) : Bool {
    if (not canView(caller, event)) return false;
    let audienceRoles = switch (event.rsvp_audience) {
      case (?"players_only") ["player"];
      case (?"parents_only") ["parent"];
      case _ ["player", "parent"];
    };
    let allowedRoles = switch (event.restricted_to_roles) {
      case (?restricted) { if (restricted.size() > 0) restricted else audienceRoles };
      case _ audienceRoles;
    };
    roleInEventScope(caller, event, allowedRoles)
  };
  func canGuardianRsvpForChild(caller : Principal, event : Types.Event, account_id : Text, child_id : Text) : Bool {
    if (account_id != caller.toText() or not canView(caller, event) or event.adults_only) return false;
    if (event.rsvp_audience == ?"parents_only") return false;
    if (switch (event.restricted_to_roles) { case (?restricted) restricted.size() > 0; case null false }) return false;
    let callerId = caller.toText();
    let linked = children.any(func(child) = child.id == child_id and child.parent_id == ?callerId) or
      childGuardians.any(func(guardian) = guardian.child_id == child_id and guardian.guardian_id == callerId);
    if (not linked) return false;
    let targets = event.target_team_ids ?? [];
    childTeamAssignments.any(func(assignment) =
      assignment.child_id == child_id and assignment.club_id == event.club_id and
      (switch (event.team_id) {
        case (?team) assignment.team_id == team;
        case null if (targets.size() > 0) targets.any(func(target) = target == assignment.team_id) else true;
      })
    )
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); if (not isGovernor(caller)) return #Err("Governor only"); if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(club_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.club_id == club_id and item.team_id == team_id)) roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func create_event(club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, opponent : ?Text, address : ?Text, mini_league_id : ?Text, starts_at_ms : Nat64, ends_at_ms : Nat64, rsvp_audience : ?Text, adults_only : Bool, restricted_to_roles : ?[Text], target_team_ids : ?[Text]) : async { #Ok : Types.Event; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer"); do { let removalReply = await syncRolesFromClubDomain(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; if (not valid(club_id) or not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or not validLocation(opponent) or not validLocation(address) or not validOptId(mini_league_id) or not validRsvpAudience(rsvp_audience) or not validRsvpPolicyLists(restricted_to_roles, target_team_ids) or starts_at_ms >= ends_at_ms) return #Err("Invalid event");
    let teamAllowed = switch (team_id) { case (?team) { hasRole(caller, "team_admin", club_id, ?team) or hasRole(caller, "coach", club_id, ?team) }; case null { false } };
    let allowed = isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or teamAllowed;
    if (not allowed) return #Err("Club or team admin required");
    let created : Types.Event = { id = "evt-" # club_id # "-" # Nat.toText(events.size()); club_id; team_id; title; description; event_type; location; cancelled = false; creator = caller; starts_at_ms; ends_at_ms; series_id = null; revision = 1; deleted = false; opponent; address; mini_league_id; updated_at_ms = nowMs(); rsvp_audience; adults_only; restricted_to_roles; target_team_ids };
    events := events.concat([created]); #Ok(created)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Association-scoped fan-out (Phase 3, F5): an association admin creates
  // the same social event in every selected member club in one call — the
  // canister counterpart of the Supabase association-create-club-event edge
  // function. association_id is the organising club's own id; the caller
  // must be its club admin (or governor/bulk access). Returns the number of
  // clubs the event was created for.
  public shared ({ caller }) func create_association_event(association_id : Text, club_ids : [Text], title : Text, description : Text, location : ?Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Nat16; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(association_id) or not valid(title) or not valid(description) or not validLocation(location) or starts_at_ms >= ends_at_ms) return #Err("Invalid event");
    if (club_ids.size() == 0 or club_ids.any(func(id) = not valid(id))) return #Err("Select at least one club");
    let allowed = isGovernor(caller) or hasBulkAccess(caller) or hasRole(caller, "club_admin", association_id, null);
    if (not allowed) return #Err("Association admin required");
    var created : [Types.Event] = [];
    var index = 0;
    for (club_id in club_ids.values()) {
      created := created.concat([({ id = "evt-" # club_id # "-" # Nat.toText(events.size() + index); club_id; team_id = null; title; description; event_type = "social"; location; cancelled = false; creator = caller; starts_at_ms; ends_at_ms; series_id = null; revision = 1; deleted = false; opponent = null; address = null; mini_league_id = null; updated_at_ms = nowMs(); rsvp_audience = null; adults_only = false; restricted_to_roles = null; target_team_ids = null } : Types.Event)]);
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func create_competition_events(
    operation_id : Text,
    competition_id : Text,
    creator : Principal,
    competition_club_id : Text,
    targets : [Types.CompetitionEventTarget],
    title : Text,
    description : Text,
    event_type : Text,
    location : ?Text,
    starts_at_ms : Nat64,
    ends_at_ms : Nat64,
  ) : async { #Ok : [Text]; #Err : Text } {
    if (not removalReceiver.enter(creator)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(creator); if (removalReceiver.denied(creator)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (competitionDomainCanister) {
      case null return #Err("competition_domain canister not configured");
      case (?configured) { if (not caller.equal(configured)) return #Err("competition_domain only"); };
    };
    if (not valid(operation_id) or not valid(competition_id) or creator.equal(Principal.anonymous()) or not valid(competition_club_id) or not valid(title) or description.size() > 2000 or not validEventType(event_type) or not validLocation(location) or starts_at_ms >= ends_at_ms or targets.size() > 500) return #Err("Invalid competition event");
    switch (competitionEventOperations.find(func(item) = item.operation_id == operation_id)) {
      case (?existing) {
        if (existing.competition_id != competition_id) return #Err("Operation id already used");
        return #Ok(existing.event_ids);
      };
      case null {};
    };
    var seenTeams : [Text] = [];
    for (target in targets.values()) {
      if (not valid(target.team_id) or not valid(target.club_id) or seenTeams.any(func(teamId) = teamId == target.team_id)) return #Err("Invalid or duplicate competition team");
      seenTeams := seenTeams.concat([target.team_id]);
    };
    let now = nowMs();
    let startIndex = events.size();
    var created : [Types.Event] = [];
    var targetIndex = 0;
    for (target in targets.values()) {
      let event : Types.Event = {
        id = "evt-" # target.club_id # "-" # Nat.toText(startIndex + targetIndex);
        club_id = target.club_id;
        team_id = ?target.team_id;
        title;
        description;
        event_type;
        location;
        cancelled = false;
        creator;
        starts_at_ms;
        ends_at_ms;
        series_id = null;
        revision = 1 : Nat64;
        deleted = false;
        opponent = null;
        address = null;
        mini_league_id = null;
        updated_at_ms = now;
        rsvp_audience = null;
        adults_only = false;
        restricted_to_roles = null;
        target_team_ids = null;
      };
      created := created.concat([event]);
      targetIndex += 1;
    };
    events := events.concat(created);
    let eventIds = created.map(func(event) = event.id);
    competitionEventOperations := competitionEventOperations.concat([{ operation_id; competition_id; event_ids = eventIds }]);
    #Ok(eventIds)
  
    } finally { removalReceiver.leave(creator) };
  };

  public shared ({caller}) func upsert_competition_match_events(input : Types.MatchEventInput) : async {#Ok:[Text];#Err:Text} {
    if (not removalReceiver.enter(input.creator)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    let authority=competitionDomainCanister;
    if(authority!=?caller) return #Err("Trusted competition canister only");
    auth(input.creator);do { let removalReply = await admitAccount(input.creator); if (removalReceiver.denied(input.creator)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (authority != competitionDomainCanister or input.teams.size() != 2 or input.starts_at_ms >= input.ends_at_ms or input.title.size() > 256) return #Err("Invalid fixture or changed authority");
    if(input.teams[0].team_id==input.teams[1].team_id or input.teams.any(func(t)=not valid(t.team_id) or not valid(t.club_id) or isFenced(t.club_id))) return #Err("Invalid or locked fixture teams");
    // Validate every existing link before touching either event.
    for(target in input.teams.values()){
      switch(competitionMatchLinks.find(func(l)=l.match_id==input.match_id and l.team_id==target.team_id)){
        case null {};
        case(?link){if(link.competition_id!=input.competition_id or events.any(func(e)=e.id==link.event_id and (e.club_id!=target.club_id or e.team_id!=?target.team_id)))return #Err("Fixture link ownership mismatch")}
      }
    };
    var ids:[Text]=[];
    for(target in input.teams.values()) {
      let previous=competitionMatchLinks.find(func(l)=l.match_id==input.match_id and l.competition_id==input.competition_id and l.team_id==target.team_id);
      let id=switch(previous){case null "evt-"#target.club_id#"-"#Nat.toText(events.size());case(?link)link.event_id};
      let current=events.find(func(e)=e.id==id);
      if(switch(current){case(?e)e.club_id!=target.club_id or e.team_id!=?target.team_id;case null false}) return #Err("Fixture link ownership mismatch");
      let row:Types.Event={id;club_id=target.club_id;team_id=?target.team_id;title=input.title;description="Competition fixture";event_type="game";location=input.venue;cancelled=false;creator=input.creator;starts_at_ms=input.starts_at_ms;ends_at_ms=input.ends_at_ms;series_id=null;revision=switch(current){case null 1;case(?e)e.revision+1};deleted=false;opponent=?input.teams[if(target.team_id==input.teams[0].team_id)1 else 0].team_id;address=null;mini_league_id=null;updated_at_ms=nowMs();rsvp_audience=null;adults_only=false;restricted_to_roles=null;target_team_ids=null};
      events:=events.filter(func(e)=e.id!=id).concat([row]);
      competitionMatchLinks:=competitionMatchLinks.filter(func(l)=l.event_id!=id).concat([{event_id=id;competition_id=input.competition_id;match_id=input.match_id;team_id=target.team_id}]);
      ids:=ids.concat([id]);
    };
    #Ok(ids)
  
    } finally { removalReceiver.leave(input.creator) };
  };

  func matchHistoryAccess(caller:Principal,event:Types.Event,managerOnly:Bool) : async {#Ok:Bool;#Err:Text} {
    let link=switch(competitionMatchLinks.find(func(l)=l.event_id==event.id)){case null return #Ok(true);case(?l)l};
    if(event.team_id!=?link.team_id) return #Err("History association mismatch");
    let authority=switch(competitionDomainCanister){case null return #Err("Competition authority unavailable");case(?id)id};
    let service:actor{read_match_score_access:shared(Text,Text,Text,Principal,Bool)->async{#Ok:Bool;#Err:Text}}=actor(authority.toText());
    let result=try{await(with timeout=10) service.read_match_score_access(link.competition_id,link.match_id,link.team_id,caller,managerOnly)}catch(_){return #Err("Competition authority unavailable")};
    if(competitionDomainCanister!=?authority or eventFenced(event.id) or not competitionMatchLinks.any(func(l)=l==link)) return #Err("History authority changed or locked");
    result
  };

  // Association panel read (Phase 3, F5): parents for one association,
  // visible to anyone the association's club admins would show it to —
  // callers must be a club admin of the association (or governor/bulk).
  // child_event_ids carries the fan-out so the panel can show counts.
  public query ({ caller }) func list_association_events(association_id : Text) : async { #Ok : [Types.AssociationEvent]; #Err : Text } {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
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
  func createSeriesInternal(caller : Principal, club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, frequency : Text, first_starts_at_ms : Nat64, first_ends_at_ms : Nat64, until_ms : Nat64, rsvp_audience : ?Text, adults_only : Bool, restricted_to_roles : ?[Text], target_team_ids : ?[Text]) : { #Ok : { series : Types.EventSeries; events : [Types.Event] }; #Err : Text } {
    if (not valid(club_id) or not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or not validFrequency(frequency) or not validRsvpAudience(rsvp_audience) or not validRsvpPolicyLists(restricted_to_roles, target_team_ids) or first_starts_at_ms >= first_ends_at_ms or first_starts_at_ms > until_ms) return #Err("Invalid series");
    let teamAllowed = switch (team_id) { case (?team) { hasRole(caller, "team_admin", club_id, ?team) or hasRole(caller, "coach", club_id, ?team) }; case null { false } };
    let allowed = isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or teamAllowed;
    if (not allowed) return #Err("Club or team admin required");
    let seriesId = "ser-" # club_id # "-" # Nat.toText(series.size());
    let created : Types.EventSeries = { id = seriesId; club_id; team_id; title; description; event_type; location; frequency; first_starts_at_ms; first_ends_at_ms; until_ms; creator = caller; revision = 1; deleted = false; rsvp_audience; adults_only; restricted_to_roles; target_team_ids };
    let step = frequencyStepMs(frequency);
    let duration = first_ends_at_ms - first_starts_at_ms;
    // Cap at 366 occurrences to bound message/state size.
    let maxCount = Nat.min(366, Nat64.toNat((until_ms - first_starts_at_ms) / step) + 1);
    let base = events.size();
    let children = Array.tabulate<Types.Event>(maxCount, func(index) {
      let offset = step * Nat.toNat64(index);
      { id = "evt-" # club_id # "-" # Nat.toText(base + index); club_id; team_id; title; description; event_type; location; cancelled = false; creator = caller; starts_at_ms = first_starts_at_ms + offset; ends_at_ms = first_starts_at_ms + offset + duration; series_id = ?seriesId; revision = 1; deleted = false; opponent = null; address = null; mini_league_id = null; updated_at_ms = nowMs(); rsvp_audience; adults_only; restricted_to_roles; target_team_ids }
    });
    series := series.concat([created]);
    events := events.concat(children);
    #Ok({ series = created; events = children })
  };

  public shared ({ caller }) func create_series(club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, frequency : Text, first_starts_at_ms : Nat64, first_ends_at_ms : Nat64, until_ms : Nat64, rsvp_audience : ?Text, adults_only : Bool, restricted_to_roles : ?[Text], target_team_ids : ?[Text]) : async { #Ok : { series : Types.EventSeries; events : [Types.Event] }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller); do { let removalReply = await syncRolesFromClubDomain(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    createSeriesInternal(caller, club_id, team_id, title, description, event_type, location, frequency, first_starts_at_ms, first_ends_at_ms, until_ms, rsvp_audience, adults_only, restricted_to_roles, target_team_ids)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Occurrence-count variant of create_series — mirrors
  // convert_event_to_recurring_series's "N occurrences" mode alongside its
  // "until date" mode. Only "weekly"/"fortnightly" are documented entry
  // points per the roadmap; daily/monthly remain accepted since
  // createSeriesInternal already validates them.
  public shared ({ caller }) func create_recurring_series(club_id : Text, team_id : ?Text, title : Text, description : Text, event_type : Text, location : ?Text, frequency : Text, first_starts_at_ms : Nat64, first_ends_at_ms : Nat64, occurrences : ?Nat32, until_ms : ?Nat64, rsvp_audience : ?Text, adults_only : Bool, restricted_to_roles : ?[Text], target_team_ids : ?[Text]) : async { #Ok : { series : Types.EventSeries; events : [Types.Event] }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller); do { let removalReply = await syncRolesFromClubDomain(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
    createSeriesInternal(caller, club_id, team_id, title, description, event_type, location, frequency, first_starts_at_ms, first_ends_at_ms, resolvedUntil, rsvp_audience, adults_only, restricted_to_roles, target_team_ids)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Detaches a single occurrence from its series (series_id -> null) without
  // touching sibling occurrences or the series record itself — the
  // one-off-edit counterpart to delete_series's future-occurrences cascade.
  public shared ({ caller }) func detach_occurrence(event_id : Text) : async { #Ok : Types.Event; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // Updates series fields and every future (>= from_ms) child event's
  // details. Times of individual occurrences are preserved.
  public shared ({ caller }) func update_series(id : Text, title : Text, description : Text, event_type : Text, location : ?Text, from_ms : Nat64, rsvp_audience : ?Text, adults_only : Bool, restricted_to_roles : ?[Text], target_team_ids : ?[Text]) : async { #Ok : Types.EventSeries; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManageSeries(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        if (not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or not validRsvpAudience(rsvp_audience) or not validRsvpPolicyLists(restricted_to_roles, target_team_ids)) return #Err("Invalid series update");
        let updated : Types.EventSeries = { current with title; description; event_type; location; rsvp_audience; adults_only; restricted_to_roles; target_team_ids; revision = current.revision + 1 };
        series := series.map(func(item) = if (item.id == id) updated else item);
        events := events.map(func(item) =
          if (item.series_id == ?id and item.starts_at_ms >= from_ms) {
            { item with title; description; event_type; location; rsvp_audience; adults_only; restricted_to_roles; target_team_ids; revision = item.revision + 1 }
          } else item
        );
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Deletes future (>= from_ms) occurrences of a series and their dependent
  // rows. When no occurrences remain, the series record itself is removed;
  // otherwise its recurrence end is truncated to from_ms.
  public shared ({ caller }) func delete_series(id : Text, from_ms : Nat64) : async { #Ok : Nat32; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_series(club_id : ?Text, team_id : ?Text) : async [Types.EventSeries] {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
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

  public shared ({ caller }) func update_event(id : Text, title : Text, description : Text, event_type : Text, location : ?Text, opponent : ?Text, address : ?Text, mini_league_id : ?Text, starts_at_ms : Nat64, ends_at_ms : Nat64, rsvp_audience : ?Text, adults_only : Bool, restricted_to_roles : ?[Text], target_team_ids : ?[Text]) : async { #Ok : Types.Event; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (events.find(func(e) = e.id == id)) { case (?e) { if (isFenced(e.club_id)) return #Err("Club is temporarily locked for a transfer"); }; case null {} };
    switch (events.find(func(e) = e.id == id)) { case (?e) { do { let removalReply = await syncRolesFromClubDomain(caller, e.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } }; case null {} };
    switch (requireManage(caller, id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        if (not valid(title) or not valid(description) or not validEventType(event_type) or not validLocation(location) or not validLocation(opponent) or not validLocation(address) or not validOptId(mini_league_id) or not validRsvpAudience(rsvp_audience) or not validRsvpPolicyLists(restricted_to_roles, target_team_ids) or starts_at_ms >= ends_at_ms) return #Err("Invalid event update");
        let updated : Types.Event = { current with title; description; event_type; location; opponent; address; mini_league_id; starts_at_ms; ends_at_ms; rsvp_audience; adults_only; restricted_to_roles; target_team_ids; revision = current.revision + 1; updated_at_ms = nowMs() };
        var index = 0;
        for (item in events.values()) { if (item.id == id) { replaceEvent(index, updated); return #Ok(updated) }; index += 1 };
        #Err("Event not found")
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Cancellation is separate from update_event so cancelling cannot
  // accidentally clobber other fields with stale browser state.
  public shared ({ caller }) func set_event_cancelled(id : Text, cancelled : Bool) : async { #Ok : Types.Event; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_rsvp(event_id : Text, account_id : Text, state : Text, notes : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (events.find(func(item) = item.id == event_id)) {
      case null return #Err("Event not found");
      case (?event) {
        if (account_id != caller.toText()) return #Err("Cannot set another member's RSVP");
        if (not canSelfRsvp(caller, event)) return #Err("Event RSVP not allowed for this member");
      };
    };
    if (not valid(account_id) or not valid(state) or notes.size() > 2000) return #Err("Invalid RSVP");
    recordRsvpCreatedAt(event_id, account_id);
    let value : Types.Rsvp = { event_id; account_id; child_id = null; state; notes; has_paid = null; source = "member"; updated_at_ms = nowMs() };
    rsvps := rsvps.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); rsvps := rsvps.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Parent RSVPs their own child (Supabase childRsvpMutation parity) — same
  // gate as set_rsvp, but keyed by (event, account, child) so a child's
  // answer never overwrites the parent's own RSVP.
  public shared ({ caller }) func set_child_rsvp(event_id : Text, account_id : Text, child_id : Text, state : Text, notes : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_)) {};
    };
    if (not valid(account_id) or not valid(child_id) or not valid(state) or notes.size() > 2000) return #Err("Invalid RSVP");
    recordRsvpCreatedAt(event_id, account_id);
    let value : Types.Rsvp = { event_id; account_id; child_id = ?child_id; state; notes; has_paid = null; source = "member"; updated_at_ms = nowMs() };
    rsvps := rsvps.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id and item.child_id == ?child_id)); rsvps := rsvps.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Note-only update on an existing RSVP (self-service), mirroring the
  // Supabase per-RSVP notes field — keeps the current state, only changes notes.
  public shared ({ caller }) func set_rsvp_note(event_id : Text, account_id : Text, notes : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_attendance(event_id : Text, account_id : Text, present : Bool, note : Text) : async { #Ok : Types.Attendance; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(_)) {};
    };
    if (not valid(account_id) or note.size() > 2000) return #Err("Invalid attendance");
    let value : Types.Attendance = { event_id; account_id; present; note };
    attendance := attendance.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); attendance := attendance.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func add_lineup(event_id : Text, member : Text, slot : Text, team_id : ?Text) : async { #Ok : Types.LineupEntry; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    let value : Types.LineupEntry = { event_id; member; slot; team_id }; lineups := lineups.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Full pitch-board snapshot per (event, team): formation, team size, ball
  // position and every player (on-pitch and bench). One upsert replaces the
  // per-player add_lineup mirroring which silently dropped formation, ball
  // position and bench players. Supersedes add_lineup for pitch-board saves.
  public shared ({ caller }) func save_lineup_snapshot(event_id : Text, team_id : ?Text, formation : ?Text, team_size : Nat16, ball_x : ?Float, ball_y : ?Float, players : [Types.LineupPlayer]) : async { #Ok : Types.LineupSnapshot; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_lineup_snapshot(event_id : Text, team_id : ?Text) : async { #Ok : ?Types.LineupSnapshot; #Err : Text } {
    denyLegacyAccountQuery();
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(lineupSnapshots.find(func(item) = item.event_id == event_id and item.team_id == team_id))
      };
    }
  };

  public shared ({ caller }) func set_duty(event_id : Text, account_id : Text, duty : Text) : async { #Ok : Types.Duty; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    // Re-setting the same duty keeps its completion state; renaming the duty
    // or assigning a different one starts incomplete.
    let completed = switch (duties.find(func(item) = item.event_id == event_id and item.account_id == account_id)) {
      case (?current) { current.duty == duty and current.completed };
      case null { false };
    };
    let value : Types.Duty = { event_id; account_id; duty; completed }; duties := duties.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); duties := duties.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
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
  // Event sponsor links (event_sponsors parity): which club sponsors are
  // attached to a specific event. Manager-gated like set_duty.
  public shared ({ caller }) func set_event_sponsors(event_id : Text, sponsor_ids : [Text]) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventSponsors := eventSponsors.filter(func((id, _)) = id != event_id).concat([(event_id, sponsor_ids)]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };
  public query ({ caller }) func get_event_sponsors(event_id : Text) : async { #Ok : [Text]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (eventSponsors.find(func((id, _)) = id == event_id)) { case (?(_, ids)) #Ok(ids); case null #Ok([]) };
  };
  public shared ({ caller }) func complete_duty(event_id : Text, account_id : Text) : async { #Ok : Types.Duty; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    setDutyCompleted(event_id, account_id, true)
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func uncomplete_duty(event_id : Text, account_id : Text) : async { #Ok : Types.Duty; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    setDutyCompleted(event_id, account_id, false)
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func remove_duty(event_id : Text, account_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not duties.any(func(item) = item.event_id == event_id and item.account_id == account_id)) return #Err("Duty not found");
    duties := duties.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func set_roster(event_id : Text, account_id : Text, child_id : ?Text) : async { #Ok : Types.RosterEntry; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    let value : Types.RosterEntry = { event_id; account_id; child_id }; roster := roster.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id)); roster := roster.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };
  // Live match timer, server-anchored on this canister. Write access mirrors
  // every other events_domain mutation keyed by event_id (set_duty,
  // set_roster, save_lineup_snapshot, ...): the caller must manage the event
  // (club/team admin, coach, creator, or governor) via requireManage.
  // `minutes_per_half` is required for "start_half"/"set_minutes" and
  // optional otherwise (kept as-is when omitted); `adjust_ms` is required
  // for "adjust" and ignored otherwise. Reads are open to anyone who can
  // view the event (canView), same visibility as get_lineup_snapshot.
  public shared ({ caller }) func set_event_timer(event_id : Text, action : Text, minutes_per_half : ?Nat16, adjust_ms : ?Int64) : async { #Ok : Types.EventTimer; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not validTimerAction(action)) return #Err("Invalid timer action");
    let resolvedMinutes = switch (minutes_per_half) { case (?m) m; case null (45 : Nat16) };
    if (resolvedMinutes == 0 or resolvedMinutes > 200) return #Err("Invalid minutes per half");
    let current = switch (eventTimers.find(func(item) = item.event_id == event_id)) {
      case (?existing) existing;
      case null defaultEventTimer(event_id, resolvedMinutes, caller);
    };
    let now = nowMs();
    let updated : Types.EventTimer = switch (action) {
      case "start_half" {
        { current with current_half = 1; minutes_per_half = resolvedMinutes; half_started_at_ms = ?now; half_paused_at_ms = null; accumulated_pause_ms = 0; is_running = true; is_game_finished = false; half_ended_at_ms = null; last_event_at_ms = now; updated_by = caller }
      };
      case "pause" {
        if (not current.is_running) return #Err("Timer is not running");
        { current with half_paused_at_ms = ?now; is_running = false; last_event_at_ms = now; updated_by = caller }
      };
      case "resume" {
        if (current.is_running) return #Err("Timer is already running");
        let extraPause = switch (current.half_paused_at_ms) { case (?pausedAt) if (now > pausedAt) now - pausedAt else (0 : Nat64); case null (0 : Nat64) };
        { current with half_paused_at_ms = null; accumulated_pause_ms = current.accumulated_pause_ms + extraPause; is_running = true; last_event_at_ms = now; updated_by = caller }
      };
      case "end_half" {
        { current with is_running = false; half_paused_at_ms = null; half_ended_at_ms = ?now; last_event_at_ms = now; updated_by = caller }
      };
      case "start_half_2" {
        { current with current_half = 2; half_started_at_ms = ?now; half_paused_at_ms = null; accumulated_pause_ms = 0; is_running = true; is_game_finished = false; half_ended_at_ms = null; last_event_at_ms = now; updated_by = caller }
      };
      case "end_game" {
        { current with is_running = false; is_game_finished = true; half_paused_at_ms = null; half_ended_at_ms = ?now; last_event_at_ms = now; updated_by = caller }
      };
      case "adjust" {
        switch (adjust_ms) {
          case null return #Err("adjust_ms required for adjust");
          case (?delta) {
            let nextPause : Int64 = Int64.fromNat64(current.accumulated_pause_ms) - delta;
            let clamped : Nat64 = if (nextPause < 0) 0 else Int64.toNat64(nextPause);
            { current with accumulated_pause_ms = clamped; last_event_at_ms = now; updated_by = caller }
          };
        };
      };
      case "set_minutes" {
        { current with minutes_per_half = resolvedMinutes; last_event_at_ms = now; updated_by = caller }
      };
      case "reset" {
        { defaultEventTimer(event_id, resolvedMinutes, caller) with last_event_at_ms = now };
      };
      case (_) { current };
    };
    eventTimers := eventTimers.filter(func(item) = item.event_id != event_id);
    eventTimers := eventTimers.concat([updated]);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_event_timer(event_id : Text) : async { #Ok : ?Types.EventTimer; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(eventTimers.find(func(item) = item.event_id == event_id))
      };
    };
  };

  public shared ({ caller }) func set_recurrence(event_id : Text, frequency : Text, until_ms : Nat64) : async { #Ok : Types.Recurrence; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not validFrequency(frequency)) return #Err("Invalid recurrence");
    let value : Types.Recurrence = { event_id; frequency; until_ms }; recurrences := recurrences.filter(func(item) = item.event_id != event_id); recurrences := recurrences.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Per-event attendance roster for a caller who can view the event
  // (club/team member, manager or governor). Counterpart of the Supabase
  // `get_targeted_event_attendance_roster` RPC fallback used by
  // EventDetailPage; child display names are resolved client-side via
  // pii_access_control's get_decrypted_pii_batch (see live/features/vault.ts).
  public query ({ caller }) func get_event_roster(event_id : Text) : async { #Ok : [Types.RosterEntry]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(roster.filter(func(item) = item.event_id == event_id))
      };
    }
  };

  public composite query ({ caller }) func list_events(club_id : ?Text, team_id : ?Text) : async [Types.Event] {
    denyLegacyAccountQuery();
    var visible : [Types.Event] = [];
    for (event in events.values()) {
      if (not event.deleted and (club_id == null or club_id == ?event.club_id) and (team_id == null or team_id == event.team_id)) {
        if (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    }) visible := visible.concat([event]);
      };
    };
    visible
  };
  public composite query ({ caller }) func list_events_multi(club_ids : [Text], team_ids : [Text]) : async { #Ok : [Types.Event]; #Err : Text } {
    denyLegacyAccountQuery();
    if (club_ids.size() + team_ids.size() > 300) return #Err("Too many ids");
    var visible : [Types.Event] = [];
    for (event in events.values()) {
      if (not event.deleted and (club_ids.any(func(c) = c == event.club_id) or (switch (event.team_id) { case (?t) team_ids.any(func(id) = id == t); case null false }))) {
        if (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    }) visible := visible.concat([event]);
      };
    };
    #Ok(visible)
  };

  public query ({ caller }) func list_events_for_duty_teams(team_ids : [Text]) : async { #Ok : [Types.Event]; #Err : Text } {
    denyLegacyAccountQuery();
    if (team_ids.size() > 100) return #Err("Too many duty teams");
    #Ok(events.filter(func(event) =
      not event.deleted and canView(caller, event) and
      eventDutyTeams.any(func(assignment) = assignment.event_id == event.id and team_ids.any(func(id) = id == assignment.team_id))
    ))
  };

  func visibleEventIds(caller : Principal, event_ids : [Text]) : [Text] {
    event_ids.filter(func(id) =
      switch (events.find(func(item) = item.id == id)) {
        case (?e) canView(caller, e);
        case null false;
      }
    )
  };

  public query ({ caller }) func get_event_rosters(event_ids : [Text]) : async { #Ok : [Types.RosterEntry]; #Err : Text } {
    denyLegacyAccountQuery();
    if (event_ids.size() > 300) return #Err("Too many ids");
    let ok = visibleEventIds(caller, event_ids);
    #Ok(roster.filter(func(item) = ok.any(func(i) = i == item.event_id)))
  };

  public query ({ caller }) func list_duties_multi(event_ids : [Text]) : async { #Ok : [Types.Duty]; #Err : Text } {
    denyLegacyAccountQuery();
    if (event_ids.size() > 300) return #Err("Too many ids");
    let ok = visibleEventIds(caller, event_ids);
    #Ok(duties.filter(func(item) = ok.any(func(i) = i == item.event_id)))
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
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // Full attendance roster for an event — coach/admin only (same gate as
  // mark_attendance), mirrors class_attendance reads.
  public query ({ caller }) func get_attendance(event_id : Text) : async { #Ok : [Types.EventAttendance]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(eventAttendance.filter(func(item) = item.event_id == event_id))
  };

  // Caller-scoped attendance read (PROVISIONAL: subject_id matched against
  // Principal.toText(caller), same convention as my_rsvps) — lets a member
  // see their own marked attendance without the coach/admin gate.
  public query ({ caller }) func my_attendance(event_id : ?Text) : async [Types.EventAttendance] {
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    if (not valid(id)) return #Err("Invalid child");
    let value : Types.Child = { id; parent_id };
    children := children.filter(func(item) = item.id != id); children := children.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func admin_link_guardian(child_id : Text, guardian_id : Text, is_primary : Bool) : async { #Ok : Types.ChildGuardian; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    if (not valid(child_id) or not valid(guardian_id)) return #Err("Invalid guardian link");
    let value : Types.ChildGuardian = { child_id; guardian_id; is_primary };
    childGuardians := childGuardians.filter(func(item) = not (item.child_id == child_id and item.guardian_id == guardian_id));
    childGuardians := childGuardians.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func add_event_guest(event_id : Text, guest_name : Text) : async { #Ok : Types.EventGuest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(guest_name)) return #Err("Invalid guest");
    let value : Types.EventGuest = { id = "guest-" # event_id # "-" # Nat.toText(eventGuests.size()); event_id; guest_name; added_by = caller; created_at_ms = nowMs() };
    eventGuests := eventGuests.concat([value]); #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_event_guest(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (eventGuests.find(func(item) = item.id == id)) {
      case null { #Err("Guest not found") };
      case (?guest) {
        switch (requireManage(caller, guest.event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
        eventGuests := eventGuests.filter(func(item) = item.id != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // RSVPs for an event enriched with child names and standalone guests —
  // mirrors the joined rsvps + event_guests + children reads guardians and
  // coaches use to see who is coming. Visibility follows canView (any club
  // member, manager or governor), same as get_event_roster.
  public query ({ caller }) func event_roster(event_id : Text) : async { #Ok : Types.EventRoster; #Err : Text } {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (events.find(func(event) = event.id == event_id)) {
      case null return #Err("Event not found");
      case (?event) {
        if (not manages(caller, event)) {
          let guardianAllowed = switch (child_id) {
            case (?child) canGuardianRsvpForChild(caller, event, account_id, child);
            case null false;
          };
          if (not guardianAllowed) return #Err("Event RSVP management forbidden");
        };
      };
    };
    if (not valid(account_id) or not validRsvpStatus(status) or notes.size() > 2000) return #Err("Invalid RSVP");
    recordRsvpCreatedAt(event_id, account_id);
    let value : Types.Rsvp = { event_id; account_id; child_id; state = status; notes; has_paid = null; source = "admin"; updated_at_ms = nowMs() };
    rsvps := rsvps.filter(func(item) = not (item.event_id == event_id and item.account_id == account_id and item.child_id == child_id));
    rsvps := rsvps.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Coach/admin flips just the status on an existing RSVP — the canister
  // equivalent of the admin_update_rsvp_status RPC. Errors if no matching
  // RSVP exists yet (use admin_upsert_rsvp to create one).
  public shared ({ caller }) func admin_update_rsvp_status(event_id : Text, account_id : Text, child_id : ?Text, status : Text) : async { #Ok : Types.Rsvp; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- RSVP created_at (preserved across status changes) ----
  public query ({ caller }) func get_rsvp_created_at(event_id : Text, account_id : Text) : async ?Nat64 {
    denyLegacyAccountQuery();
    auth(caller);
    switch (rsvpCreatedAt.find(func(item) = item.event_id == event_id and item.account_id == account_id)) {
      case null null;
      case (?item) ?item.created_at_ms;
    };
  };

  // ---- Favourite event titles (per-caller shortlist for CreateEventPage) ----
  func callerAccountId(caller : Principal) : Text { Principal.toText(caller) };

  public query ({ caller }) func list_favourite_event_titles() : async [Text] {
    denyLegacyAccountQuery();
    auth(caller);
    let me = callerAccountId(caller);
    favouriteEventTitles.filter(func(item) = item.account_id == me).map(func(item) = item.title);
  };

  public shared ({ caller }) func add_favourite_event_title(title : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(title)) return #Err("Invalid title");
    let me = callerAccountId(caller);
    if (not favouriteEventTitles.any(func(item) = item.account_id == me and item.title == title)) {
      favouriteEventTitles := favouriteEventTitles.concat([{ account_id = me; title }]);
    };
    #Ok;
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_favourite_event_title(title : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let me = callerAccountId(caller);
    favouriteEventTitles := favouriteEventTitles.filter(func(item) = not (item.account_id == me and item.title == title));
    #Ok;
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Saved locations (per-caller addresses for AddressAutocomplete) ----
  public query ({ caller }) func list_saved_locations() : async [Types.SavedLocation] {
    denyLegacyAccountQuery();
    auth(caller);
    let me = callerAccountId(caller);
    savedLocations.filter(func(item) = item.account_id == me);
  };

  public shared ({ caller }) func save_location(location_label : Text, address : Text, lat : Float, lng : Float) : async { #Ok : Types.SavedLocation; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(location_label) or address == "" or address.size() > 256) return #Err("Invalid location");
    let me = callerAccountId(caller);
    let value : Types.SavedLocation = {
      id = "loc-" # me # "-" # Nat.toText(savedLocations.size());
      account_id = me; location_label; address; lat; lng; created_at_ms = nowMs();
    };
    savedLocations := savedLocations.concat([value]);
    #Ok(value);
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_saved_location(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let me = callerAccountId(caller);
    switch (savedLocations.find(func(item) = item.id == id and item.account_id == me)) {
      case null { #Err("Saved location not found") };
      case (?_) { savedLocations := savedLocations.filter(func(item) = item.id != id); #Ok };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Training default RSVP (per caller + club + team + optional child) ----
  // Applied by the UI when listing/creating new training events; child_id =
  // null is the caller's own default (not RSVPing on behalf of a child).
  public query ({ caller }) func get_training_default(club_id : Text, team_id : Text, child_id : ?Text) : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not valid(club_id) or not valid(team_id)) return #Err("Invalid training default lookup");
    let me = callerAccountId(caller);
    switch (trainingDefaults.find(func(item) = item.account_id == me and item.club_id == club_id and item.team_id == team_id and item.child_id == child_id)) {
      case null { #Ok(null) };
      case (?item) { #Ok(?item.default_rsvp) };
    };
  };

  public shared ({ caller }) func set_training_default(club_id : Text, team_id : Text, child_id : ?Text, default_rsvp : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(club_id) or not valid(team_id) or not validRsvpStatus(default_rsvp)) return #Err("Invalid training default");
    let me = callerAccountId(caller);
    let value : Types.TrainingDefault = { account_id = me; club_id; team_id; child_id; default_rsvp; updated_at_ms = nowMs() };
    trainingDefaults := trainingDefaults.filter(func(item) = not (item.account_id == me and item.club_id == club_id and item.team_id == team_id and item.child_id == child_id));
    trainingDefaults := trainingDefaults.concat([value]);
    #Ok;
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- (1) Soft delete: event + series (cascades occurrences) ----
  // Soft-deletes a single event in place — distinct from any hard-delete
  // path; the row stays, deleted=true just hides it from list_events.
  public shared ({ caller }) func delete_event(id : Text) : async { #Ok : Types.Event; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // Soft-deletes a series and cascades deleted=true onto every child
  // occurrence, without removing any rows — the soft counterpart to
  // delete_series's hard cascade/truncate.
  public shared ({ caller }) func soft_delete_series(id : Text) : async { #Ok : Types.EventSeries; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- (2) Coach notes (per event, coach/admin authorized) ----
  public shared ({ caller }) func set_coach_note(event_id : Text, note : Text) : async { #Ok : Types.CoachNote; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (note.size() > 4000) return #Err("Note too long");
    let value : Types.CoachNote = { event_id; note; updated_by = caller; updated_at_ms = nowMs() };
    coachNotes := coachNotes.filter(func(item) = item.event_id != event_id);
    coachNotes := coachNotes.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_coach_note(event_id : Text) : async { #Ok : ?Types.CoachNote; #Err : Text } {
    denyLegacyAccountQuery();
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(coachNotes.find(func(item) = item.event_id == event_id))
  };

  // ---- (3) Per-occurrence series trim/extend ----
  // detach_occurrence (above) already trims a single occurrence off its
  // series. This is the inverse: append a brand-new occurrence to an
  // existing series (e.g. "add one more training date").
  public shared ({ caller }) func add_series_occurrence(series_id : Text, starts_at_ms : Nat64, ends_at_ms : Nat64) : async { #Ok : Types.Event; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (seriesFenced(series_id)) return #Err("Club is temporarily locked for a transfer");
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
          rsvp_audience = item.rsvp_audience; adults_only = item.adults_only;
          restricted_to_roles = item.restricted_to_roles; target_team_ids = item.target_team_ids;
        };
        events := events.concat([created]);
        #Ok(created)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- (4) Event views, reminder log, push reachability ----
  public shared ({ caller }) func record_event_view(event_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  /// Location-only lookup for group routing: which club owns this event, if
  /// it lives in this canister. Viewers only; returns null when not held here.
  public composite query ({ caller }) func read_event_club(event_id : Text) : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    if (Principal.isAnonymous(caller)) return #Err("Sign in required");
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Ok(null) };
      case (?event) { if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    })) #Err("Forbidden") else #Ok(?event.club_id) };
    }
  };

  public query ({ caller }) func get_event_view_count(event_id : Text) : async { #Ok : Nat32; #Err : Text } {
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(channel) or not valid(recipient)) return #Err("Invalid reminder");
    let value : Types.ReminderLog = { id = "rem-" # event_id # "-" # Nat.toText(reminderLogs.size()); event_id; channel; recipient; sent_at_ms = nowMs() };
    reminderLogs := reminderLogs.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_reminders(event_id : Text) : async { #Ok : [Types.ReminderLog]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(reminderLogs.filter(func(item) = item.event_id == event_id))
  };

  // Push reachability is a caller-set flag only; actual push delivery stays
  // off-chain (this just records whether a device can currently be reached).
  public shared ({ caller }) func set_push_reachable(reachable : Bool) : async { #Ok : Types.PushReachability; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let value : Types.PushReachability = { user = caller; reachable; updated_at_ms = nowMs() };
    pushReachability := pushReachability.filter(func(item) = not item.user.equal(caller));
    pushReachability := pushReachability.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_push_reachable(principal : Principal) : async { #Ok : ?Bool; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(switch (pushReachability.find(func(item) = item.user.equal(principal))) { case (?item) ?item.reachable; case null null })
  };

  // get_reminder_log: summary mirroring the Supabase event_reminder_log RPC
  // shape AttendanceSection expects (sent_at + recipients_count of the most
  // recent reminder batch — entries sharing the latest sent_at_ms).
  public query ({ caller }) func get_reminder_log(event_id : Text) : async { #Ok : { sent_at_ms : ?Nat64; recipients_count : Nat32 }; #Err : Text } {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(pushReachability.any(func(item) = Principal.toText(item.user) == account_id and item.reachable))
  };

  // ---- (5) Event groups + players + duties ----
  public shared ({ caller }) func create_event_group(event_id : Text, name : Text, team_letter : ?Text, colour : ?Text, ability_band : ?Text, pitch_name : ?Text) : async { #Ok : Types.EventGroup; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(name)) return #Err("Invalid group name");
    let value : Types.EventGroup = { timer_state_json = null; pitch_state_json = null; state_revision = 0; id = "grp-" # event_id # "-" # Nat.toText(eventGroups.size()); event_id; name; created_at_ms = nowMs(); team_letter; colour; team_b_colour = null; display_order = Nat.toNat16(eventGroups.size()); ability_band; pitch_name };
    eventGroups := eventGroups.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  func requireManageGroup(caller : Principal, group_id : Text) : { #Ok : Types.EventGroup; #Err : Text } {
    switch (eventGroups.find(func(item) = item.id == group_id)) {
      case null { #Err("Group not found") };
      case (?group) { switch (requireManage(caller, group.event_id)) { case (#Err(e)) #Err(e); case (#Ok(_)) #Ok(group) } };
    }
  };

  public shared ({ caller }) func rename_event_group(group_id : Text, name : Text) : async { #Ok : Types.EventGroup; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // set_event_group_appearance: auto-generate/team-colour/ability-band/pitch
  // UI support — sets the optional display fields independently of the
  // group's name so a rename doesn't clobber them (and vice versa).
  public shared ({ caller }) func set_event_group_appearance(group_id : Text, team_letter : ?Text, colour : ?Text, ability_band : ?Text, pitch_name : ?Text, team_b_colour : ?Text) : async { #Ok : Types.EventGroup; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManageGroup(caller, group_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(current)) {
        let updated : Types.EventGroup = { current with team_letter; colour; ability_band; pitch_name; team_b_colour };
        eventGroups := eventGroups.map(func(item) = if (item.id == group_id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_event_group(group_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public composite query ({ caller }) func list_event_groups(event_id : Text) : async { #Ok : [Types.EventGroup]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    })) return #Err("Forbidden"); #Ok(eventGroups.filter(func(item) = item.event_id == event_id)) };
    }
  };

  public shared ({ caller }) func add_group_player(group_id : Text, account_id : Text, team_letter : ?Text) : async { #Ok : Types.EventGroupPlayer; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(account_id)) return #Err("Invalid player");
    let value : Types.EventGroupPlayer = { group_id; account_id; team_letter };
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == group_id and item.account_id == account_id));
    eventGroupPlayers := eventGroupPlayers.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_group_player(group_id : Text, account_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == group_id and item.account_id == account_id));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Moves a player from one group to another (both groups must belong to
  // the same event the caller manages).
  public shared ({ caller }) func move_group_player(from_group_id : Text, to_group_id : Text, account_id : Text, team_letter : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (requireManageGroup(caller, from_group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    switch (requireManageGroup(caller, to_group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == from_group_id and item.account_id == account_id));
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == to_group_id and item.account_id == account_id));
    eventGroupPlayers := eventGroupPlayers.concat([{ group_id = to_group_id; account_id; team_letter }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Swaps two players sitting in two (possibly different) groups.
  // account_a moves into group_b taking team_b (account_b's former team/slot);
  // account_b moves into group_a taking team_a (account_a's former team/slot).
  public shared ({ caller }) func swap_group_players(group_a : Text, account_a : Text, team_a : ?Text, group_b : Text, account_b : Text, team_b : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (requireManageGroup(caller, group_a)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    switch (requireManageGroup(caller, group_b)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == group_a and item.account_id == account_a));
    eventGroupPlayers := eventGroupPlayers.filter(func(item) = not (item.group_id == group_b and item.account_id == account_b));
    eventGroupPlayers := eventGroupPlayers.concat([{ group_id = group_b; account_id = account_a; team_letter = team_b }, { group_id = group_a; account_id = account_b; team_letter = team_a }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public composite query ({ caller }) func list_group_players(group_id : Text) : async { #Ok : [Types.EventGroupPlayer]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (eventGroups.find(func(item) = item.id == group_id)) {
      case null { #Err("Group not found") };
      case (?group) {
        switch (events.find(func(item) = item.id == group.event_id)) {
          case null { #Err("Event not found") };
          case (?event) { if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    })) return #Err("Forbidden"); #Ok(eventGroupPlayers.filter(func(item) = item.group_id == group_id)) };
        };
      };
    }
  };

  // Location and permissions do not confer resource access: every read/write rechecks.
  public composite query ({ caller }) func get_event_group(group_id : Text) : async { #Ok : ?Types.EventGroup; #Err : Text } {
    denyLegacyAccountQuery();
    let group = switch (eventGroups.find(func(g) = g.id == group_id)) { case null return #Ok(null); case (?g) g };
    let event = switch (events.find(func(e) = e.id == group.event_id)) { case null return #Ok(null); case (?e) e };
    if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    })) return #Err("Forbidden");
    #Ok(?group)
  };
  public composite query ({ caller }) func read_event_group_club(group_id : Text) : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    let group = switch (eventGroups.find(func(g) = g.id == group_id)) { case null return #Ok(null); case (?g) g };
    let event = switch (events.find(func(e) = e.id == group.event_id)) { case null return #Ok(null); case (?e) e };
    #Ok(if ((if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    })) ?event.club_id else null)
  };
  func canEditGroupState(caller : Principal, group : Types.EventGroup) : Bool {
    let event = switch (events.find(func(e) = e.id == group.event_id)) { case null return false; case (?e) e };
    manages(caller, event) or roleInEventScope(caller, event, ["league_admin", "coach"]) or eventGroupDuties.any(func(d) =
      d.group_id == group.id and d.account_id == ?caller.toText() and (d.duty == "Referee" or d.duty == "Subs Manager"))
  };
  public composite query ({ caller }) func get_group_edit_access(group_id : Text) : async { #Ok : Bool; #Err : Text } {
    denyLegacyAccountQuery();
    let group = switch (eventGroups.find(func(g) = g.id == group_id)) { case null return #Err("Group not found"); case (?g) g };
    let event = switch (events.find(func(e) = e.id == group.event_id)) { case null return #Err("Event not found"); case (?e) e };
    #Ok((if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    }) and canEditGroupState(caller, group))
  };
  // Exact revision CAS; no await between authorization and commit.
  public shared ({ caller }) func sync_group_state(group_id : Text, expected_revision : Nat64, timer_json : ?Text, pitch_json : ?Text) : async { #Ok : Types.EventGroup; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    let group = switch (eventGroups.find(func(g) = g.id == group_id)) { case null return #Err("Group not found"); case (?g) g };
    let event = switch (events.find(func(e) = e.id == group.event_id)) { case null return #Err("Event not found"); case (?e) e };
    if (not (do { let removalReply = await* canViewMatch(caller, event); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
    // Reload after await: duties, fences and revision may change while verifying.
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    let current = switch (eventGroups.find(func(g) = g.id == group_id)) { case null return #Err("Group not found"); case (?g) g };
    let currentEvent = switch (events.find(func(e) = e.id == current.event_id)) { case null return #Err("Event not found"); case (?e) e };
    if (currentEvent.deleted or currentEvent.revision != event.revision or currentEvent.mini_league_id != event.mini_league_id or currentEvent.club_id != event.club_id or current.event_id != event.id or not canEditGroupState(caller, current)) return #Err("Forbidden");
    if (current.state_revision != expected_revision) return #Err("State revision conflict");
    if ((switch (timer_json) { case (?t) t.size() > 8192; case null false }) or (switch (pitch_json) { case (?t) t.size() > 262144; case null false })) return #Err("Match state too large");
    let updated : Types.EventGroup = { current with timer_state_json = timer_json; pitch_state_json = pitch_json; state_revision = current.state_revision + 1 };
    eventGroups := eventGroups.map(func(g) = if (g.id == group_id) updated else g);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };
  // An explicit slot id supports repeated names and exact reassignment/deletion.
  public shared ({ caller }) func save_group_duty_slot(group_id : Text, slot_id : Text, duty : Text, account_id : ?Text) : async { #Ok : Types.EventGroupDuty; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(slot_id) or not valid(duty) or not validOptId(account_id)) return #Err("Invalid duty");
    if (eventGroupDuties.any(func(d) = d.id == slot_id and d.group_id != group_id)) return #Err("Duty id belongs to another group");
    let value : Types.EventGroupDuty = { id = slot_id; group_id; duty; account_id };
    eventGroupDuties := eventGroupDuties.filter(func(d) = d.id != slot_id).concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func remove_group_duty_slot(group_id : Text, slot_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupDuties := eventGroupDuties.filter(func(d) = not (d.group_id == group_id and d.id == slot_id));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_group_duty(group_id : Text, duty : Text, account_id : ?Text) : async { #Ok : Types.EventGroupDuty; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(duty)) return #Err("Invalid duty");
    let value : Types.EventGroupDuty = { id = "legacy:" # group_id # ":" # duty; group_id; duty; account_id };
    eventGroupDuties := eventGroupDuties.filter(func(item) = item.id != "legacy:" # group_id # ":" # duty);
    eventGroupDuties := eventGroupDuties.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_group_duty(group_id : Text, duty : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManageGroup(caller, group_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    eventGroupDuties := eventGroupDuties.filter(func(item) = item.id != "legacy:" # group_id # ":" # duty);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public composite query ({ caller }) func list_group_duties(group_id : Text) : async { #Ok : [Types.EventGroupDuty]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (eventGroups.find(func(item) = item.id == group_id)) {
      case null { #Err("Group not found") };
      case (?group) {
        switch (events.find(func(item) = item.id == group.event_id)) {
          case null { #Err("Event not found") };
          case (?event) { if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { await ml.can_read_league_matches(caller, leagueId, event.club_id) } catch (_) { false }
      };
      case _ false;
    })) return #Err("Forbidden"); #Ok(eventGroupDuties.filter(func(item) = item.group_id == group_id)) };
        };
      };
    }
  };

  // ---- (6) Team training pauses ----
  // Refreshes the caller's mirrored roles for one club from club_domain (the
  // source of truth for club/team admin and coach grants). Replaces the
  // caller's previous mirror for that club so removed roles drop out.
  // Errors or an unwired club_domain leave the local list untouched.
  func syncRolesFromClubDomain(caller : Principal, club_id : Text) : async () {
    switch (clubDomainCanister) {
      case null {};
      case (?cid) {
        let cd : actor { list_user_club_roles : shared query (Principal, Text) -> async [(Text, ?Text)]; read_account_list_user_club_roles : shared (Principal, Text) -> async [(Text, ?Text)] } = actor (Principal.toText(cid));
        try {
          let fresh = if (accountAdmissionEnabled) await cd.read_account_list_user_club_roles(caller, club_id) else await cd.list_user_club_roles(caller, club_id);
          let mirrored = fresh.filter(func((role, _)) = role == "club_admin" or role == "team_admin" or role == "coach");
          roles := roles.filter(func(item) = not (item.user.equal(caller) and item.club_id == club_id))
            .concat(mirrored.map(func((role, team)) = { user = caller; role; club_id; team_id = team }));
        } catch (_) {};
      };
    };
  };

  func managesTeam(caller : Principal, club_id : Text, team_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or hasRole(caller, "team_admin", club_id, ?team_id) or hasRole(caller, "coach", club_id, ?team_id)
  };

  public shared ({ caller }) func create_team_training_pause(club_id : Text, team_id : Text, starts_at_ms : Nat64, ends_at_ms : Nat64, reason : Text) : async { #Ok : Types.TeamTrainingPause; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller); do { let removalReply = await syncRolesFromClubDomain(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not valid(club_id) or not valid(team_id) or starts_at_ms >= ends_at_ms or reason.size() > 2000) return #Err("Invalid pause");
    if (not managesTeam(caller, club_id, team_id)) return #Err("Club or team admin required");
    let value : Types.TeamTrainingPause = { id = "pause-" # club_id # "-" # team_id # "-" # Nat.toText(teamTrainingPauses.size()); club_id; team_id; starts_at_ms; ends_at_ms; reason; created_by = caller; created_at_ms = nowMs() };
    teamTrainingPauses := teamTrainingPauses.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_team_training_pauses(club_id : Text, team_id : Text) : async { #Ok : [Types.TeamTrainingPause]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isClubMember(caller, club_id) and not managesTeam(caller, club_id, team_id)) return #Err("Forbidden");
    #Ok(teamTrainingPauses.filter(func(item) = item.club_id == club_id and item.team_id == team_id))
  };

  public shared ({ caller }) func delete_team_training_pause(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (teamTrainingPauses.find(func(item) = item.id == id)) {
      case null { #Err("Pause not found") };
      case (?pause) {
        if (not managesTeam(caller, pause.club_id, pause.team_id) and not pause.created_by.equal(caller)) return #Err("Forbidden");
        teamTrainingPauses := teamTrainingPauses.filter(func(item) = item.id != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func is_paused(club_id : Text, team_id : Text, at_ms : Nat64) : async { #Ok : Bool; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isClubMember(caller, club_id) and not managesTeam(caller, club_id, team_id)) return #Err("Forbidden");
    #Ok(teamTrainingPauses.any(func(item) = item.club_id == club_id and item.team_id == team_id and item.starts_at_ms <= at_ms and at_ms <= item.ends_at_ms))
  };

  // ---- (7) Membership / child-scope check helpers ----
  // Mirrors a team-roster-membership check other domains could replicate:
  // any role grant scoped to this club+team (or club-wide) counts as
  // membership, same convention as isClubMember.
  public query ({ caller }) func is_team_member(principal : Principal, club_id : Text, team_id : Text) : async Bool {
    denyLegacyAccountQuery();
    roles.any(func(grant) = grant.user.equal(principal) and grant.club_id == club_id and (grant.team_id == ?team_id or grant.team_id == null))
  };

  // Mirrors a guardian-of-child check other domains could replicate against
  // their own guardian data; here it reads events_domain's own
  // childGuardians table (PROVISIONAL text-id convention, see ChildGuardian).
  public query ({ caller }) func is_guardian_of(principal : Principal, child_id : Text) : async Bool {
    denyLegacyAccountQuery();
    childGuardians.any(func(item) = item.child_id == child_id and item.guardian_id == Principal.toText(principal))
  };

  // ---- (8) Open-duty creation / claiming ----
  public shared ({ caller }) func create_open_duty(event_id : Text, duty : Text) : async { #Ok : Types.OpenDuty; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    if (openDuties.filter(func(item) = item.event_id == event_id).size() >= 200) return #Err("Too many open duties for this event");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not valid(duty)) return #Err("Invalid duty");
    let value : Types.OpenDuty = { id = "oduty-" # event_id # "-" # Nat.toText(openDuties.size()); event_id; duty; claimed_by = null; created_at_ms = nowMs() };
    openDuties := openDuties.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func claim_open_duty(id : Text, account_id : Text) : async { #Ok : Types.OpenDuty; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func unclaim_open_duty(id : Text) : async { #Ok : Types.OpenDuty; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(id) or groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_open_duties(event_id : Text) : async { #Ok : [Types.OpenDuty]; #Err : Text } {
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
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
      newGroups := newGroups.concat([{ timer_state_json = null; pitch_state_json = null; state_revision = (0 : Nat64); id; event_id; name = spec.name; created_at_ms = nowMs(); team_letter = null; colour = spec.team_a_colour; team_b_colour = spec.team_b_colour; display_order = spec.display_order; ability_band = spec.ability_band; pitch_name = spec.pitch_name }]);
      newPlayers := newPlayers.concat(spec.players.map(func(p) : Types.EventGroupPlayer = { group_id = id; account_id = p.account_id; team_letter = p.team_letter }));
      for (d in spec.duties.values()) { newDuties := newDuties.concat([{ id = "batch:" # id # ":" # Nat.toText(newDuties.size()); group_id = id; duty = d.duty; account_id = d.account_id }]) };
      createdIds := createdIds.concat([id]);
      index += 1;
    };
    eventGroups := eventGroups.concat(newGroups);
    eventGroupPlayers := eventGroupPlayers.concat(newPlayers);
    eventGroupDuties := eventGroupDuties.concat(newDuties);
    #Ok(createdIds)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Event-level duty listing (assignee-keyed duties, used by match duty distribution) ----
  public query ({ caller }) func list_duties(event_id : Text) : async { #Ok : [Types.Duty]; #Err : Text } {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
    auth(caller);
    let callerId = Principal.toText(caller);
    let guardedIds = childGuardians.filter(func(g) = g.guardian_id == callerId).map(func(g) = g.child_id);
    children.filter(func(c) = (c.parent_id == ?callerId) or guardedIds.any(func(id) = id == c.id))
  };

  public shared ({ caller }) func admin_upsert_child_team_assignment(child_id : Text, team_id : Text, club_id : Text) : async { #Ok : Types.ChildTeamAssignment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller) and not hasRole(caller, "club_admin", club_id, null)) return #Err("Admin required");
    if (not valid(child_id) or not valid(team_id) or not valid(club_id)) return #Err("Invalid assignment");
    let value : Types.ChildTeamAssignment = { child_id; team_id; club_id };
    childTeamAssignments := childTeamAssignments.filter(func(item) = not (item.child_id == child_id and item.team_id == team_id));
    childTeamAssignments := childTeamAssignments.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_child_team_assignment(child_id : Text, team_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Admin required");
    childTeamAssignments := childTeamAssignments.filter(func(item) = not (item.child_id == child_id and item.team_id == team_id));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Scoped to club membership (same visibility convention as list_team_training_pauses).
  public query ({ caller }) func list_child_team_assignments(club_id : Text, team_id : Text) : async { #Ok : [Types.ChildTeamAssignment]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isClubMember(caller, club_id)) return #Err("Forbidden");
    #Ok(childTeamAssignments.filter(func(item) = item.club_id == club_id and item.team_id == team_id))
  };

  // Every team a given child is assigned to, scoped to the caller being that
  // child's guardian (or governor/bulk) — used to scope RSVP eligibility.
  public query ({ caller }) func my_child_team_assignments(child_id : Text) : async { #Ok : [Types.ChildTeamAssignment]; #Err : Text } {
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    if (not validSubject(subject) or not valid(state)) return #Err("Invalid RSVP");
    let value : Types.MiniLeagueRsvp = { event_id; subject; state; updated_at_ms = nowMs() };
    miniLeagueRsvps := miniLeagueRsvps.filter(func(item) = not (item.event_id == event_id and subjectEquals(item.subject, subject)));
    miniLeagueRsvps := miniLeagueRsvps.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_mini_league_rsvps(event_id : Text) : async { #Ok : [Types.MiniLeagueRsvp]; #Err : Text } {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (teamFenced(team_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(event_id) or not valid(team_id)) return #Err("Invalid game summary");
    if (not canManageTeamBoard(caller, team_id)) return #Err("Game summary management forbidden");
    let value : Types.GameSummary = { event_id; team_id; total_game_time; half_duration; formation_used; total_substitutions; updated_at_ms = nowMs() };
    gameSummaries := gameSummaries.filter(func(item) = item.event_id != event_id).concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_game_summary(event_id : Text) : async { #Ok : ?Types.GameSummary; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    let event=switch(events.find(func(e)=e.id==event_id and not e.deleted)){case null return #Err("Event not found");case(?e)e};
    if(not canView(caller,event)) return #Err("Event access forbidden");
    #Ok(gameSummaries.find(func(item) = item.event_id == event_id))
  };

  public shared ({ caller }) func save_game_player_stats(
    event_id : Text,
    team_id : Text,
    stats : [Types.GamePlayerStatInput],
  ) : async { #Ok : [Types.GamePlayerStat]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(event_id) or not valid(team_id)) return #Err("Invalid game player stats");
    if (not canManageTeamBoard(caller, team_id)) return #Err("Game stats management forbidden");
    let event=switch(events.find(func(e)=e.id==event_id and e.team_id==?team_id and not e.deleted)){case null return #Err("Game-stat team mismatch");case(?e)e};
    switch(do { let removalReply = await matchHistoryAccess(caller,event,true); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }){case(#Ok(true)){};case _ return #Err("Competition manager required")};
    if(eventFenced(event_id) or not canManageTeamBoard(caller,team_id)) return #Err("Game-stat authority changed");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  func protectedPlayerStats(caller : Principal, event_id : Text) : async { #Ok : [Types.GamePlayerStat]; #Err : Text } {
    switch (await historyResult(caller,event_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(result)) {
        let hidden = switch (result) {
          case null competitionEventOperations.any(func(operation) = operation.event_ids.any(func(id) = id == event_id)) or competitionMatchLinks.any(func(l)=l.event_id==event_id);
          case (?r) r.scores_hidden
        };
        #Ok(gamePlayerStats.filter(func(item) = item.event_id == event_id).map(func(item : Types.GamePlayerStat) : Types.GamePlayerStat {
          if (hidden) ({ item with goals_scored = 0 : Nat16 }) else item
        }))
      }
    }
  };
  public shared ({ caller }) func list_game_player_stats(event_id : Text) : async { #Ok : [Types.GamePlayerStat]; #Err : Text } {
    await protectedPlayerStats(caller,event_id)
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (teamFenced(team_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(team_id) or not valid(sport)) return #Err("Invalid game result");
    if (not canManageTeamBoard(caller, team_id)) return #Err("Game result management forbidden");
    switch (event_id) {
      case null {};
      case (?id) {
        let event = switch (events.find(func(e) = e.id == id and not e.deleted)) { case null return #Err("Event not found"); case (?e) e };
        if (event.team_id != ?team_id) return #Err("Game result team mismatch");
        let authority = competitionDomainCanister;
        switch(do { let removalReply = await matchHistoryAccess(caller,event,true); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }){case(#Ok(true)){};case _ return #Err("Competition manager required")};
        for (operation in competitionEventOperations.values()) {
          if (operation.event_ids.any(func(e) = e == id)) {
            let configured = switch (authority) { case null return #Err("Competition authority unavailable"); case (?a) a };
            let competition : actor { read_history_score_access : shared (Text, Text, Nat64, Principal, Bool) -> async { #Ok : Bool; #Err : Text } } = actor (configured.toText());
            try {
              switch (do { let removalReply = await (with timeout = 10) competition.read_history_score_access(operation.competition_id,team_id,event.starts_at_ms,caller,true); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
                case (#Ok(true)) {};
                case _ return #Err("Competition manager required")
              }
            } catch (_) { return #Err("Competition authorization unavailable") };
          }
        };
        switch(competitionMatchLinks.find(func(l)=l.event_id==id)){
          case null {};
          case(?link){
            let configured=switch(authority){case null return #Err("Competition authority unavailable");case(?a)a};
            let service:actor{write_history_match_result:shared(Text,Text,Principal,Nat32,Nat32)->async{#Ok;#Err:Text}}=actor(configured.toText());
            switch(try{do { let removalReply = await(with timeout=10)service.write_history_match_result(link.match_id,team_id,caller,home_score,away_score); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }}catch(_){return #Err("Competition result synchronization failed")}){case(#Err(e))return #Err(e);case(#Ok){}};
          }
        };
        if (authority != competitionDomainCanister or eventFenced(id) or teamFenced(team_id)) return #Err("Game authority changed or locked");
      }
    };
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
  
    } finally { removalReceiver.leave(caller) };
  };

  func historyResult(caller : Principal, event_id : Text) : async { #Ok : ?HistoryPrivacy.Read; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    auth(caller);
    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let event = switch (events.find(func(e) = e.id == event_id and not e.deleted)) {
      case null return #Err("Event not found"); case (?e) e
    };
    do { let removalReply = await syncRolesFromClubDomain(caller, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not (do { let removalReply = await* canViewMatch(caller, event); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Event access forbidden");
    let authority = competitionDomainCanister;
    var hidden = false;
    switch(do { let removalReply = await matchHistoryAccess(caller,event,false); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }){case(#Err(e))return #Err(e);case(#Ok(visible))hidden:=not visible};
    for (operation in competitionEventOperations.values()) {
      if (operation.event_ids.any(func(id) = id == event_id)) {
        let id = switch (authority) { case null return #Err("Competition authority unavailable"); case (?id) id };
        let competition : actor {
          read_history_score_access : shared (Text, Text, Nat64, Principal, Bool) -> async { #Ok : Bool; #Err : Text }
        } = actor (id.toText());
        let team = switch (event.team_id) { case null return #Err("Competition team missing"); case (?t) t };
        try {
          switch (do { let removalReply = await (with timeout = 10) competition.read_history_score_access(operation.competition_id, team, event.starts_at_ms, caller,false); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
            case (#Err(e)) return #Err(e);
            case (#Ok(visible)) { if (not visible) hidden := true }
          }
        } catch (_) { return #Err("Competition score authorization unavailable") };
      }
    };
    if (authority != competitionDomainCanister or eventFenced(event_id)) return #Err("Event authority changed or locked");
    let current = switch (events.find(func(e) = e.id == event_id and not e.deleted)) {
      case null return #Err("Event no longer available"); case (?e) e
    };
    if (current.revision != event.revision or not canView(caller,current)) return #Err("Event access changed");
    var canonical: ?{home:?Nat16;away:?Nat16;hidden:Bool}=null;
    switch(competitionMatchLinks.find(func(l)=l.event_id==event_id)){
      case null {};
      case(?link){
        let configured=switch(authority){case null return #Err("Competition authority unavailable");case(?a)a};
        let service:actor{read_history_match_result:shared(Text,Text,Principal)->async{#Ok:{home:?Nat16;away:?Nat16;hidden:Bool};#Err:Text}}=actor(configured.toText());
        switch(try{do { let removalReply = await(with timeout=10)service.read_history_match_result(link.match_id,link.team_id,caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }}catch(_){return #Err("Competition result unavailable")}){case(#Err(e))return #Err(e);case(#Ok(r))canonical:=?r};
      }
    };
    if(authority!=competitionDomainCanister or eventFenced(event_id))return #Err("History authority changed");
    #Ok(switch (gameResults.find(func(item) = item.event_id == ?event_id)) {
      case null null; case (?row) {
        let read=HistoryPrivacy.read(row,hidden or (switch(canonical){case null false;case(?r)r.hidden}));
        ?(switch(canonical){case null read;case(?r)({read with home_score=r.home.map(func(n)=Nat32.fromNat(Nat16.toNat(n)));away_score=r.away.map(func(n)=Nat32.fromNat(Nat16.toNat(n)))})})
      }
    })
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func get_game_result(event_id : Text) : async { #Ok : ?HistoryPrivacy.Read; #Err : Text } {
    await historyResult(caller,event_id)
  };

  public shared ({ caller }) func delete_game_result(event_id : Text) : async { #Ok; #Err : Text } {
    switch (await historyResult(caller,event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(null)) return #Ok;
      case (#Ok(?row)) { if (row.scores_hidden) return #Err("Competition manager required") }
    };
    let event = switch (events.find(func(e) = e.id == event_id and not e.deleted)) {
      case null return #Err("Event not found"); case (?e) e
    };
    if (not manages(caller,event) or eventFenced(event_id)) return #Err("Game result management forbidden");
    switch(await matchHistoryAccess(caller,event,true)){case(#Ok(true)){};case _ return #Err("Competition manager required")};
    // Removing a competition's mirrored History is also a result mutation.
    let authority = competitionDomainCanister;
    for (operation in competitionEventOperations.values()) {
      if (operation.event_ids.any(func(id) = id == event_id)) {
        let configured = switch (authority) { case null return #Err("Competition authority unavailable"); case (?id) id };
        let team = switch (event.team_id) { case null return #Err("Competition team missing"); case (?id) id };
        let competition : actor { read_history_score_access : shared (Text,Text,Nat64,Principal,Bool) -> async { #Ok : Bool; #Err : Text } } = actor (configured.toText());
        try {
          switch (await (with timeout = 10) competition.read_history_score_access(operation.competition_id,team,event.starts_at_ms,caller,true)) {
            case (#Ok(true)) {}; case _ return #Err("Competition manager required")
          }
        } catch (_) { return #Err("Competition authority unavailable") };
      }
    };
    if (authority != competitionDomainCanister or eventFenced(event_id)) return #Err("Game authority changed or locked");
    gameResults := gameResults.filter(func(row) = row.event_id != ?event_id);
    #Ok
  };

  // ---- Match captains / goalkeepers / player stats report ----
  func validRefKind(value : Text) : Bool { value == "account" or value == "child" };

  public shared ({ caller }) func set_match_captain(event_id : Text, ref_kind : Text, ref_id : Text, role : Text) : async { #Ok : Types.MatchCaptainAssignment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(event_id) or not validRefKind(ref_kind) or not valid(ref_id) or (role != "captain" and role != "vice")) return #Err("Invalid captain assignment");
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        let value : Types.MatchCaptainAssignment = { event_id; ref_kind; ref_id; role; assigned_by = caller; updated_at_ms = nowMs() };
        matchCaptainAssignments := matchCaptainAssignments.filter(func(item) = not (item.event_id == event_id and item.ref_kind == ref_kind and item.ref_id == ref_id and item.role == role)).concat([value]);
        #Ok(value)
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_match_captain(event_id : Text, ref_kind : Text, ref_id : Text, role : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        matchCaptainAssignments := matchCaptainAssignments.filter(func(item) = not (item.event_id == event_id and item.ref_kind == ref_kind and item.ref_id == ref_id and item.role == role));
        #Ok;
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_match_captains(event_id : Text) : async { #Ok : [Types.MatchCaptainAssignment]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(matchCaptainAssignments.filter(func(item) = item.event_id == event_id))
  };

  public shared ({ caller }) func set_match_goalkeeper(event_id : Text, ref_kind : Text, ref_id : Text, period : Text) : async { #Ok : Types.MatchGoalkeeperAssignment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(event_id) or not validRefKind(ref_kind) or not valid(ref_id) or not valid(period)) return #Err("Invalid goalkeeper assignment");
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        let value : Types.MatchGoalkeeperAssignment = { event_id; ref_kind; ref_id; period; assigned_by = caller; updated_at_ms = nowMs() };
        matchGoalkeeperAssignments := matchGoalkeeperAssignments.filter(func(item) = not (item.event_id == event_id and item.period == period)).concat([value]);
        #Ok(value)
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_match_goalkeeper(event_id : Text, period : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        matchGoalkeeperAssignments := matchGoalkeeperAssignments.filter(func(item) = not (item.event_id == event_id and item.period == period));
        #Ok;
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_match_goalkeepers(event_id : Text) : async { #Ok : [Types.MatchGoalkeeperAssignment]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(matchGoalkeeperAssignments.filter(func(item) = item.event_id == event_id))
  };

  // Folds one stat bump into rows, inserting a fresh row keyed by
  // (ref_kind, ref_id) on first sight.
  func bumpPlayerStat(rows : [Types.PlayerStatRow], ref_kind : Text, ref_id : Text, mvp : Nat32, captain : Nat32, vice : Nat32, gk : Nat32) : [Types.PlayerStatRow] {
    switch (rows.find(func(r) = r.ref_kind == ref_kind and r.ref_id == ref_id)) {
      case (?existing) {
        rows.filter(func(r) = not (r.ref_kind == ref_kind and r.ref_id == ref_id)).concat([{
          existing with
          mvp_count = existing.mvp_count + mvp;
          captain_count = existing.captain_count + captain;
          vice_count = existing.vice_count + vice;
          goalkeeper_count = existing.goalkeeper_count + gk;
        }]);
      };
      case null { rows.concat([{ ref_kind; ref_id; mvp_count = mvp; captain_count = captain; vice_count = vice; goalkeeper_count = gk }]) };
    };
  };

  // Aggregates MVP counts (from existing GameResult rows), captain/vice
  // counts (MatchCaptainAssignment) and goalkeeper counts
  // (MatchGoalkeeperAssignment) per player over every non-deleted event for
  // club_id (optionally narrowed to team_id) whose starts_at_ms falls in
  // [from_ms, to_ms]. Team-staff authorization reuses managesTeam (club_admin
  // / team_admin / coach), same as create_team_training_pause.
  public query ({ caller }) func get_player_stats_report(club_id : Text, team_id : ?Text, from_ms : Nat64, to_ms : Nat64) : async { #Ok : [Types.PlayerStatRow]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not valid(club_id)) return #Err("Invalid club");
    let teamAllowed = switch (team_id) { case (?t) managesTeam(caller, club_id, t); case null false };
    if (not isGovernor(caller) and not hasRole(caller, "club_admin", club_id, null) and not teamAllowed) return #Err("Team staff required");
    let matchingEvents = events.filter(func(e) = e.club_id == club_id and not e.deleted and e.starts_at_ms >= from_ms and e.starts_at_ms <= to_ms and (switch (team_id) { case (?t) e.team_id == ?t; case null true }));
    let eventIds = matchingEvents.map(func(e) = e.id);
    var rows : [Types.PlayerStatRow] = [];
    for (cap in matchCaptainAssignments.values()) {
      if (eventIds.any(func(id) = id == cap.event_id)) {
        if (cap.role == "captain") { rows := bumpPlayerStat(rows, cap.ref_kind, cap.ref_id, 0, 1, 0, 0) }
        else { rows := bumpPlayerStat(rows, cap.ref_kind, cap.ref_id, 0, 0, 1, 0) };
      };
    };
    for (gk in matchGoalkeeperAssignments.values()) {
      if (eventIds.any(func(id) = id == gk.event_id)) {
        rows := bumpPlayerStat(rows, gk.ref_kind, gk.ref_id, 0, 0, 0, 1);
      };
    };
    for (gr in gameResults.values()) {
      switch (gr.event_id) {
        case (?eid) {
          if (eventIds.any(func(id) = id == eid)) {
            switch (gr.mvp_player_id) {
              case (?pid) { rows := bumpPlayerStat(rows, "account", pid, 1, 0, 0, 0) };
              case null {};
            };
          };
        };
        case null {};
      };
    };
    #Ok(rows)
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
    let logTeam = switch (team_id) { case (?t) t; case null "" };
    let cutoff : Nat64 = if (value.updated_at_ms > writeLogWindowMs()) value.updated_at_ms - writeLogWindowMs() else 0;
    activeGameWriteLog := activeGameWriteLog.filter(func((_, ts)) = ts >= cutoff).concat([(logTeam, value.updated_at_ms)]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Admin monitor (AdminActiveGamesPage): every active or recently-ended
  // game updated at/after since_ms, regardless of caller. Gated so only the
  // governor or a club_domain app_admin can see every club's live boards.
  public shared ({ caller }) func list_active_games(since_ms : Nat64) : async { #Ok : [Types.ActiveGame]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not (do { let removalReply = await requireAppAdmin(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("App admin required");
    #Ok(activeGames.filter(func(item) = item.updated_at_ms >= since_ms));
  
    } finally { removalReceiver.leave(caller) };
  };

  // Admin monitor: per-team sync_active_game call counts since since_ms
  // (from the bounded recent-write log), used to flag "sync storm" teams.
  // Same app-admin gate as list_active_games; a null/empty team_id groups
  // under "" (per-caller sessions with no team).
  public shared ({ caller }) func list_active_game_write_rates(since_ms : Nat64) : async { #Ok : [(Text, Nat32)]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not (do { let removalReply = await requireAppAdmin(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("App admin required");
    var counts : [(Text, Nat32)] = [];
    for ((team, ts) in activeGameWriteLog.values()) {
      if (ts >= since_ms) {
        counts := switch (counts.find(func((t, _)) = t == team)) {
          case (?(_, n)) counts.map(func((t, n2)) = if (t == team) (t, n2 + (1 : Nat32)) else (t, n2));
          case null counts.concat([(team, (1 : Nat32))]);
        };
      };
    };
    #Ok(counts);
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func deactivate_active_game(team_id : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    activeGames := activeGames.map(func(item) : Types.ActiveGame {
      let owns = switch (team_id) { case (?t) item.team_id == ?t; case null item.user_id.equal(caller) and item.team_id == null };
      if (owns and item.is_active) { { item with is_active = false } } else { item }
    });
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_active_game(team_id : ?Text) : async { #Ok : ?Types.ActiveGame; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(activeGames.find(func(item) = item.is_active and (switch (team_id) { case (?t) item.team_id == ?t; case null item.user_id.equal(caller) and item.team_id == null })))
  };

  // ---- Workstream D: admin per-viewer event-view list + per-user viewed-ids ----
  public query ({ caller }) func list_event_views(event_id : Text) : async { #Ok : [Types.EventView]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(eventViews.filter(func(item) = item.event_id == event_id));
    }
  };

  public query ({ caller }) func list_my_viewed_event_ids(event_ids : [Text]) : async { #Ok : [Text]; #Err : Text } {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
  
    } finally { removalReceiver.leave(caller) };
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

  func playhqHttpGetTenant(path : Text, tenant : ?Text) : async* { #Ok : Text; #Err : Text } {
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
      ].concat(switch(tenant){case null [];case(?value)[{name="x-phq-tenant";value}]});
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
  func playhqHttpGet(path:Text):async*{#Ok:Text;#Err:Text}{await* playhqHttpGetTenant(path,null)};

  func playhqPages(path:Text,tenant:Text):async*{#Ok:[Json.Json];#Err:Text}{
    var rows:[Json.Json]=[];var cursor:?Text=null;var seen:[Text]=[];var pages=0;
    while (pages < 10) {
      if (pages >= 10) return #Err("PlayHQ pagination exceeds bounded import");
      let suffix=switch(cursor){case null "";case(?c)"?cursor="#c};
      let body=switch(await* playhqHttpGetTenant(path#suffix,?tenant)){case(#Err(e))return #Err(e);case(#Ok(b))b};
      let page=switch(PlayhqFeed.page(body)){case(#Err(e))return #Err(e);case(#Ok(p))p};
      rows:=rows.concat(page.rows);pages+=1;
      if (rows.size() > 2000) return #Err("PlayHQ batch exceeds bounds");
      switch(page.cursor){
        case null return #Ok(rows);
        case(?next){
          // Restrict cursor to unreserved URL characters; never inject a path/query.
          if (next.size() > 512 or seen.any(func(c)=c==next) or Text.toArray(next).any(func(c)=not ((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9') or c=='-' or c=='_' or c=='.' or c=='~')))return #Err("Invalid pagination cursor");
          seen:=seen.concat([next]);cursor:=?next
        }
      }
    };
    #Err("PlayHQ pagination exceeds bounded import")
  };

  // Production PlayHQ endpoint shapes, complete bounded pages only. This
  // returns solely to the configured competition service, never a browser.
  public shared ({caller}) func fetch_playhq_grade(tenant:Text,grade:Text) : async {#Ok:{games:[{game_id:Text;home_id:Text;away_id:Text;home_name:Text;away_name:Text;home_score:?Nat16;away_score:?Nat16;starts_at_ms:?Nat64;status:Text;venue:?Text}];stats:[{game_id:Text;team_id:Text;player_id:Text;player_name:Text;stats_json:Text}]};#Err:Text} {
    let authority=competitionDomainCanister;
    if(authority!=?caller) return #Err("Trusted competition canister only");
    if(not valid(tenant) or not valid(grade) or Text.contains(grade,#char '/') or Text.contains(tenant,#char '/') or Text.contains(grade,#char '?')) return #Err("Invalid PlayHQ scope");
    let rows=switch(await* playhqPages("/grades/"#grade#"/fixture",tenant)){case(#Err(e))return #Err(e);case(#Ok(r))r};
    if (rows.size() > 200) return #Err("Grade exceeds bounded import");
    var games:[{game_id:Text;home_id:Text;away_id:Text;home_name:Text;away_name:Text;home_score:?Nat16;away_score:?Nat16;starts_at_ms:?Nat64;status:Text;venue:?Text}]=[];
    var stats:[{game_id:Text;team_id:Text;player_id:Text;player_name:Text;stats_json:Text}]=[];
    for(row in rows.values()) {
      let id=PlayhqFeed.str(row,"id");
      if(not valid(id) or Text.contains(id,#char '/') or Text.contains(id,#char '?')) return #Err("Invalid game identity");
      let home=PlayhqFeed.field(PlayhqFeed.field(row,"teams"),"home");let away=PlayhqFeed.field(PlayhqFeed.field(row,"teams"),"away");
      let h=PlayhqFeed.str(home,"id");let a=PlayhqFeed.str(away,"id");
      if(not valid(h) or not valid(a) or h==a) return #Err("Invalid fixture teams");
      let score=PlayhqFeed.field(row,"score");let status=Text.toUpper(PlayhqFeed.str(row,"status"));
      let state=if(Text.contains(status,#text "COMPLETE") or Text.contains(status,#text "FINAL") or status=="FT")"completed"else if(Text.contains(status,#text "CANCEL") or Text.contains(status,#text "FORFEIT"))"cancelled"else "scheduled";
      let date=PlayhqFeed.str(PlayhqFeed.field(row,"schedule"),"date");
      let venue=PlayhqFeed.str(PlayhqFeed.field(row,"venue"),"name");
      games:=games.concat([{game_id=id;home_id=h;away_id=a;home_name=PlayhqFeed.str(home,"name");away_name=PlayhqFeed.str(away,"name");home_score=PlayhqFeed.score(score,"home");away_score=PlayhqFeed.score(score,"away");starts_at_ms=parsePlayhqTime(if(date=="")PlayhqFeed.str(row,"startsAt")else date,"UTC");status=state;venue=if(venue=="")null else ?venue}]);
      if(state=="completed") {
        let players=switch(await* playhqPages("/games/"#id#"/statistics",tenant)){case(#Err(e))return #Err(e);case(#Ok(r))r};
        for(p in players.values()) {
          let player=PlayhqFeed.field(p,"player");let playerId=PlayhqFeed.str(player,"id");let team=PlayhqFeed.str(PlayhqFeed.field(p,"team"),"id");
          if(not valid(playerId) or (team!=h and team!=a)) return #Err("Foreign player-stat team");
          let values=switch(PlayhqFeed.field(p,"statistics")){case(#null_)PlayhqFeed.field(p,"stats");case(v)v};
          stats:=stats.concat([{game_id=id;team_id=team;player_id=playerId;player_name=PlayhqFeed.str(player,"name");stats_json=PlayhqFeed.numeric(values)}]);
          if (stats.size() > 2000) return #Err("Player-stat batch too large");
        }
      }
    };
    if(authority!=competitionDomainCanister) return #Err("Competition authority changed");
    #Ok({games;stats})
  };

  // Mirrors PlayHQTeamLinkCard's Supabase `competitions` read: id/name/season
  // for the tenant+org the club has configured (club_domain owns those two
  // values; the frontend passes them straight through).
  public shared ({ caller }) func list_playhq_competitions(tenant : Text, org_id : Text) : async { #Ok : [Types.PlayHQCompetition]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(tenant) or not valid(org_id)) return #Err("Invalid tenant/org");
    switch (do { let removalReply = await* playhqHttpGet("/v1/" # tenant # "/organisations/" # org_id # "/competitions"); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // Mirrors PlayHQTeamLinkCard's Supabase `competition_matches` read: the
  // external home/away team ids + names for a given competition's fixture.
  public shared ({ caller }) func list_playhq_fixtures(competition_id : Text) : async { #Ok : [Types.PlayHQMatch]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(competition_id)) return #Err("Invalid competition id");
    switch (do { let removalReply = await* playhqHttpGet("/v1/competitions/" # competition_id # "/fixture"); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- PlayHQ team fixture import (on-chain playhq-materialise-team-events) ----
  // Reads the competition fixture via HTTPS outcall and mirrors the linked
  // team's games as "game" events: new games are created, changed games are
  // updated, and future games that vanished from (or were cancelled in) the
  // feed are cancelled. Teams with auto-sync on are re-imported every 6 h.

  public query ({ caller }) func get_playhq_config_status() : async { #Ok : { configured : Bool; base_url : ?Text; updated_at_ms : ?Nat64 }; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isGovernor(caller)) return #Err("Governor only");
    switch (playHQConfig) {
      case null #Ok({ configured = false; base_url = null; updated_at_ms = null });
      case (?c) #Ok({ configured = true; base_url = ?c.base_url; updated_at_ms = ?c.updated_at_ms });
    }
  };

  func digitsToInt(cs : [Char], from : Nat, len : Nat) : ?Int {
    if (from + len > cs.size()) return null;
    var v : Int = 0;
    var i = from;
    while (i < from + len) {
      let c = cs[i];
      if (c < '0' or c > '9') return null;
      v := v * 10 + (Nat32.toNat(Char.toNat32(c)) - 48);
      i += 1;
    };
    ?v
  };

  // Howard Hinnant's days_from_civil (proleptic Gregorian, UTC).
  func daysFromCivil(y0 : Int, m : Int, d : Int) : Int {
    let y = if (m <= 2) y0 - 1 else y0;
    let era = (if (y >= 0) y else y - 399) / 400;
    let yoe = y - era * 400;
    let mp = if (m > 2) m - 3 else m + 9;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
  };

  func firstSunday(y : Int, m : Int) : Int {
    let wd = (daysFromCivil(y, m, 1) + 4) % 7; // 0 = Sunday
    1 + (7 - wd) % 7
  };

  // Offset (minutes east of UTC) for a local wall-clock date in an
  // Australian/NZ zone. DST approximated as first Sunday Oct → first Sunday Apr.
  func zoneOffsetMin(tz : Text, y : Int, m : Int, d : Int) : Int {
    let lower = Text.toLower(tz);
    let dst = if (m >= 11 or m <= 3) true else if (m == 10) d >= firstSunday(y, 10) else if (m == 4) d < firstSunday(y, 4) else false;
    if (Text.contains(lower, #text "perth")) 480
    else if (Text.contains(lower, #text "darwin")) 570
    else if (Text.contains(lower, #text "adelaide") or Text.contains(lower, #text "broken_hill")) (if dst 630 else 570)
    else if (Text.contains(lower, #text "brisbane") or Text.contains(lower, #text "lindeman")) 600
    else if (Text.contains(lower, #text "auckland")) (if dst 780 else 720)
    else (if dst 660 else 600)
  };

  // "YYYY-MM-DD" + optional "THH:MM[:SS][.fff][Z|±HH:MM]". Without an offset
  // the wall clock is interpreted in `tz`.
  func parsePlayhqTime(text : Text, tz : Text) : ?Nat64 {
    let cs = Text.toArray(text);
    let y = switch (digitsToInt(cs, 0, 4)) { case (?v) v; case null return null };
    let mo = switch (digitsToInt(cs, 5, 2)) { case (?v) v; case null return null };
    let d = switch (digitsToInt(cs, 8, 2)) { case (?v) v; case null return null };
    var h : Int = 0; var mi : Int = 0; var sec : Int = 0;
    var i = 10;
    if (cs.size() > 11 and (cs[10] == 'T' or cs[10] == ' ')) {
      h := switch (digitsToInt(cs, 11, 2)) { case (?v) v; case null 0 };
      mi := switch (digitsToInt(cs, 14, 2)) { case (?v) v; case null 0 };
      i := 16;
      if (cs.size() > 18 and cs[16] == ':') { sec := switch (digitsToInt(cs, 17, 2)) { case (?v) v; case null 0 }; i := 19 };
      while (i < cs.size() and (cs[i] == '.' or (cs[i] >= '0' and cs[i] <= '9'))) { i += 1 };
    };
    if (mo < 1 or mo > 12 or d < 1 or d > 31 or h > 23 or mi > 59) return null;
    var offsetMin : Int = zoneOffsetMin(tz, y, mo, d);
    if (i < cs.size()) {
      if (cs[i] == 'Z') { offsetMin := 0 }
      else if (cs[i] == '+' or cs[i] == '-') {
        let oh = switch (digitsToInt(cs, i + 1, 2)) { case (?v) v; case null 0 };
        let om = if (i + 4 < cs.size() and cs[i + 3] == ':') (switch (digitsToInt(cs, i + 4, 2)) { case (?v) v; case null 0 }) else (switch (digitsToInt(cs, i + 3, 2)) { case (?v) v; case null 0 });
        offsetMin := (if (cs[i] == '-') -1 else 1) * (oh * 60 + om);
      };
    };
    let ms = ((daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + sec) - offsetMin * 60) * 1000;
    if (ms <= 0) null else ?Nat64.fromNat(Int.abs(ms))
  };

  type PlayhqGame = { game_id : Text; starts_ms : Nat64; venue : ?Text; opponent : Text; is_home : Bool; cancelled : Bool };

  func firstStr(obj : Text, keys : [Text]) : ?Text {
    for (k in keys.values()) {
      switch (findJsonStringValue(obj, k)) { case (?v) { if (v != "") return ?v }; case null {} };
    };
    null
  };

  func parsePlayhqGames(body : Text, playhq_team_id : Text) : [PlayhqGame] {
    var arr = extractJsonArray(body, "matches");
    if (arr == "") arr := extractJsonArray(body, "games");
    if (arr == "") arr := extractJsonArray(body, "data");
    let objs = splitJsonObjects(if (arr == "") body else arr);
    var out : [PlayhqGame] = [];
    for (obj in objs.values()) {
      var homeId : ?Text = null; var awayId : ?Text = null;
      var homeName = ""; var awayName = "";
      let homeObj = extractJsonObject(obj, "homeTeam");
      let awayObj = extractJsonObject(obj, "awayTeam");
      if (homeObj != "" or awayObj != "") {
        homeId := findJsonStringValue(homeObj, "id");
        awayId := findJsonStringValue(awayObj, "id");
        homeName := switch (findJsonStringValue(homeObj, "name")) { case (?v) v; case null "" };
        awayName := switch (findJsonStringValue(awayObj, "name")) { case (?v) v; case null "" };
      } else {
        let teamObjs = splitJsonObjects(extractJsonArray(obj, "teams"));
        for (t in teamObjs.values()) {
          let tid = findJsonStringValue(t, "id");
          let tname = switch (findJsonStringValue(t, "name")) { case (?v) v; case null "" };
          if (Text.contains(t, #text "\"isHomeTeam\":true") and homeId == null) { homeId := tid; homeName := tname }
          else if (awayId == null) { awayId := tid; awayName := tname }
          else { homeId := tid; homeName := tname };
        };
      };
      let isHome = homeId == ?playhq_team_id;
      let isAway = awayId == ?playhq_team_id;
      let gameId = switch (findJsonStringValue(obj, "id")) { case (?v) v; case null "" };
      if ((isHome or isAway) and gameId != "") {
        let opponent = if (isHome) awayName else homeName;
        let schedule = extractJsonObject(obj, "schedule");
        let tz = switch (firstStr(if (schedule == "") obj else schedule, ["timezone", "timeZone"])) { case (?v) v; case null "Australia/Sydney" };
        let iso : ?Text = switch (firstStr(obj, ["startTime", "startDateTime", "dateTime", "scheduledStartTime", "startsAt"])) {
          case (?v) ?v;
          case null {
            let src = if (schedule == "") obj else schedule;
            switch (findJsonStringValue(src, "date")) {
              case (?date) ?(date # "T" # (switch (findJsonStringValue(src, "time")) { case (?t) t; case null "00:00:00" }));
              case null null;
            }
          };
        };
        let startsOpt = switch (iso) { case (?t) parsePlayhqTime(t, tz); case null null };
        let status = Text.toUpper(switch (findJsonStringValue(obj, "status")) { case (?v) v; case null "" });
        let cancelled = Text.contains(status, #text "CANCEL") or Text.contains(status, #text "POSTPON") or Text.contains(status, #text "ABANDON");
        let venueObj = extractJsonObject(obj, "venue");
        let venue = if (venueObj == "") null else findJsonStringValue(venueObj, "name");
        switch (startsOpt) {
          case (?starts) { if (opponent != "") out := out.concat([{ game_id = gameId; starts_ms = starts; venue; opponent; is_home = isHome; cancelled }]) };
          case null {};
        };
      };
    };
    out
  };

  func clip(t : Text, max : Nat) : Text {
    if (t.size() <= max) t else Text.fromArray(Array.tabulate<Char>(max, func(i) = Text.toArray(t)[i]))
  };

  func importPlayhqTeam(club_id : Text, team_id : Text, competition_id : Text, playhq_team_id : Text, actor_ : Principal) : async* { #Ok : Types.PlayHQImportResult; #Err : Text } {
    if (removalReceiver.denied(actor_)) return #Err("Account removal fenced");
    let body = switch (await* playhqHttpGet("/v1/competitions/" # competition_id # "/fixture")) {
      case (#Err(e)) return #Err(e);
      case (#Ok(b)) b;
    };
    if (removalReceiver.denied(actor_) or isFenced(club_id)) return #Err("Account or club fenced after callback");
    let games = parsePlayhqGames(body, playhq_team_id);
    if (games.size() == 0) return #Err("No fixtures found for this team in PlayHQ yet");
    let now = nowMs();
    let duration : Nat64 = 90 * 60_000;
    var created : Nat32 = 0; var updated : Nat32 = 0; var cancelledN : Nat32 = 0;
    for (g in games.values()) {
      let title = clip((if (g.is_home) "vs " else "@ ") # g.opponent, 120);
      let location = switch (g.venue) { case (?v) ?clip(v, 120); case null null };
      let opponent = ?clip(g.opponent, 120);
      switch (playhqEventLinks.find(func(l) = l.team_id == team_id and l.playhq_game_id == g.game_id)) {
        case (?link) {
          switch (events.find(func(e) = e.id == link.event_id)) {
            case (?e) {
              if (not e.deleted and (e.starts_at_ms != g.starts_ms or e.location != location or e.opponent != opponent or e.cancelled != g.cancelled or e.title != title)) {
                if (g.cancelled and not e.cancelled) cancelledN += 1 else updated += 1;
                events := events.map<Types.Event, Types.Event>(func(x) = if (x.id == e.id) { { x with title; starts_at_ms = g.starts_ms; ends_at_ms = g.starts_ms + duration; location; opponent; cancelled = g.cancelled; revision = x.revision + 1; updated_at_ms = now } } else x);
              };
            };
            case null {};
          };
        };
        case null {
          if (not g.cancelled) {
            let ev : Types.Event = { id = "evt-" # club_id # "-" # Nat.toText(events.size()); club_id; team_id = ?team_id; title; description = "PlayHQ fixture"; event_type = "game"; location; cancelled = false; creator = actor_; starts_at_ms = g.starts_ms; ends_at_ms = g.starts_ms + duration; series_id = null; revision = 1; deleted = false; opponent; address = null; mini_league_id = null; updated_at_ms = now; rsvp_audience = null; adults_only = false; restricted_to_roles = null; target_team_ids = null };
            events := events.concat([ev]);
            playhqEventLinks := playhqEventLinks.concat([{ event_id = ev.id; team_id; playhq_game_id = g.game_id }]);
            created += 1;
          };
        };
      };
    };
    // Future linked games that no longer appear in the feed are cancelled.
    for (link in playhqEventLinks.values()) {
      if (link.team_id == team_id and not games.any(func(g) = g.game_id == link.playhq_game_id)) {
        switch (events.find(func(e) = e.id == link.event_id)) {
          case (?e) {
            if (not e.cancelled and not e.deleted and e.starts_at_ms > now) {
              events := events.map<Types.Event, Types.Event>(func(x) = if (x.id == e.id) { { x with cancelled = true; revision = x.revision + 1; updated_at_ms = now } } else x);
              cancelledN += 1;
            };
          };
          case null {};
        };
      };
    };
    #Ok({ created; updated; cancelled = cancelledN })
  };

  func canManageTeamFixtures(caller : Principal, club_id : Text, team_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "club_admin", club_id, null) or hasRole(caller, "team_admin", club_id, ?team_id) or hasRole(caller, "coach", club_id, ?team_id)
  };

  /// Imports the linked team's PlayHQ fixtures as game events now.
  public shared ({ caller }) func import_playhq_team_fixtures(club_id : Text, team_id : Text, competition_id : Text, playhq_team_id : Text) : async { #Ok : Types.PlayHQImportResult; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(club_id) or not valid(team_id) or not valid(competition_id) or not valid(playhq_team_id)) return #Err("Invalid PlayHQ link");
    do { let removalReply = await syncRolesFromClubDomain(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not canManageTeamFixtures(caller, club_id, team_id)) return #Err("Club or team admin required");
    let r = do { let removalReply = await* importPlayhqTeam(club_id, team_id, competition_id, playhq_team_id, caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let (ok, err) = switch (r) { case (#Ok(_)) (true, null); case (#Err(e)) (false, ?e) };
    playhqTeamSyncs := playhqTeamSyncs.map<Types.PlayHQTeamSync, Types.PlayHQTeamSync>(func(s) = if (s.team_id == team_id) { { s with last_synced_at_ms = if ok ?nowMs() else s.last_synced_at_ms; last_error = err } } else s);
    r
  
    } finally { removalReceiver.leave(caller) };
  };

  /// Records (or clears, when either id is null) the team's PlayHQ link and
  /// auto-sync flag so the 6-hourly sweep can keep its fixtures current.
  public shared ({ caller }) func set_playhq_team_sync(club_id : Text, team_id : Text, competition_id : ?Text, playhq_team_id : ?Text, auto : Bool) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(club_id) or not valid(team_id) or not validOptId(competition_id) or not validOptId(playhq_team_id)) return #Err("Invalid PlayHQ link");
    do { let removalReply = await syncRolesFromClubDomain(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not canManageTeamFixtures(caller, club_id, team_id)) return #Err("Club or team admin required");
    let rest = playhqTeamSyncs.filter(func(s) = s.team_id != team_id);
    switch (competition_id, playhq_team_id) {
      case (?c, ?p) {
        if (rest.size() >= 5000) return #Err("Too many PlayHQ links");
        let prev = playhqTeamSyncs.find(func(s) = s.team_id == team_id);
        playhqTeamSyncs := rest.concat([{
          club_id; team_id; competition_id = c; playhq_team_id = p; auto; updated_by = caller;
          last_synced_at_ms = switch (prev) { case (?s) s.last_synced_at_ms; case null null };
          last_error = null;
        }]);
      };
      case _ { playhqTeamSyncs := rest };
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_playhq_team_sync(team_id : Text) : async { #Ok : ?Types.PlayHQTeamSync; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(playhqTeamSyncs.find(func(s) = s.team_id == team_id))
  };

  transient var playhqSweepCursor : Nat = 0;
  func sweepPlayhqAutoSync() : async () {
    if (playHQConfig == null) return;
    // Cost control: only refresh teams with a game in the last 2 days or the
    // next 14 days (or no games yet, so the first import still happens).
    let now = nowMs();
    let dayMs : Nat64 = 86_400_000;
    let windowStart : Nat64 = if (now > 2 * dayMs) now - 2 * dayMs else 0;
    let windowEnd : Nat64 = now + 14 * dayMs;
    let autos = playhqTeamSyncs.filter(func(s) {
      if (not s.auto) return false;
      var hasAny = false;
      for (e in events.values()) {
        if (not e.deleted and e.team_id == ?s.team_id) {
          hasAny := true;
          if (e.starts_at_ms >= windowStart and e.starts_at_ms <= windowEnd) return true;
        };
      };
      not hasAny
    });
    if (autos.size() == 0) return;
    let batch = 20;
    var i = 0;
    while (i < batch and i < autos.size()) {
      let s = autos[(playhqSweepCursor + i) % autos.size()];
      if (not removalReceiver.enter(s.updated_by)) { i += 1; continue };
      try {
      await admitAccount(s.updated_by);
      let r = await* importPlayhqTeam(s.club_id, s.team_id, s.competition_id, s.playhq_team_id, s.updated_by);
      if (removalReceiver.denied(s.updated_by)) { i += 1; continue };
      let (ok, err) = switch (r) { case (#Ok(_)) (true, null); case (#Err(e)) (false, ?e) };
      playhqTeamSyncs := playhqTeamSyncs.map<Types.PlayHQTeamSync, Types.PlayHQTeamSync>(func(x) = if (x.team_id == s.team_id) { { x with last_synced_at_ms = if ok ?nowMs() else x.last_synced_at_ms; last_error = err } } else x);
      i += 1;
      } finally { removalReceiver.leave(s.updated_by) };
    };
    playhqSweepCursor := (playhqSweepCursor + batch) % autos.size();
  };
  transient let _playhqTimer = Timer.recurringTimer<system>(#seconds(21_600), sweepPlayhqAutoSync);

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

  public shared ({ caller }) func set_mini_league_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (Principal.isAnonymous(id)) return #Err("Invalid canister id");
    miniLeagueDomainCanister := ?id;
    #Ok
  };

  public shared ({ caller }) func set_competition_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    competitionDomainCanister := ?id;
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
    autoReminders := autoReminders.filter(func(r) = not inDoomed(r.event_id));
    eventDutyTeams := eventDutyTeams.filter(func(item) = not inDoomed(item.event_id) and not inDoomedTeam(item.team_id));
    dutyTeamReminderSent := dutyTeamReminderSent.filter(func(id) = not inDoomed(id));
    pointsReminderSent := pointsReminderSent.filter(func(id) = not inDoomed(id));
    individualDutyReminderSent := individualDutyReminderSent.filter(func(id) = not inDoomed(id));
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) return #Err(e);
      case (#Ok(event)) { do { let removalReply = await fanOutReminder(event); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_event_duty_team(event_id : Text) : async { #Ok : ?Types.EventDutyTeam; #Err : Text } {
    denyLegacyAccountQuery();
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(eventDutyTeams.find(func(item) = item.event_id == event_id))
      };
    }
  };

  public query ({ caller }) func list_event_duty_teams(event_ids : [Text]) : async { #Ok : [Types.EventDutyTeam]; #Err : Text } {
    denyLegacyAccountQuery();
    if (event_ids.size() > 300) return #Err("Too many event ids");
    let visibleIds = visibleEventIds(caller, event_ids);
    #Ok(eventDutyTeams.filter(func(item) = visibleIds.any(func(id) = id == item.event_id)))
  };

  public shared ({ caller }) func set_event_duty_team(event_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let event = switch (requireManage(caller, event_id)) {
      case (#Err(error)) return #Err(error);
      case (#Ok(value)) value;
    };
    switch (team_id) {
      case null {};
      case (?team) {
        let clubCanister = switch (clubDomainCanister) {
          case null return #Err("club_domain canister not configured");
          case (?value) value;
        };
        let club : actor {
          get_team : shared query (Text) -> async { #Ok : ?{ id : Text; club_id : Text; is_active : Bool; deleted_at_ms : ?Nat64; archived : Bool; is_shell : Bool }; #Err : Text };
        } = actor (Principal.toText(clubCanister));
        let teamResult = try { do { let removalReply = await club.get_team(team); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { return #Err("Could not validate duty team") };
        switch (teamResult) {
          case (#Err(_)) return #Err("Could not validate duty team");
          case (#Ok(null)) return #Err("Duty team not found");
          case (#Ok(?value)) {
            if (value.club_id != event.club_id or not value.is_active or value.archived or value.deleted_at_ms != null or value.is_shell) {
              return #Err("Duty team must be an active team in this club");
            };
          };
        };
      };
    };
    switch (requireManage(caller, event_id)) {
      case (#Err(error)) return #Err(error);
      case (#Ok(_)) {};
    };
    eventDutyTeams := eventDutyTeams.filter(func(item) = item.event_id != event_id);
    dutyTeamReminderSent := dutyTeamReminderSent.filter(func(id) = id != event_id);
    switch (team_id) {
      case null {};
      case (?team) { eventDutyTeams := eventDutyTeams.concat([{ event_id; team_id = team }]) };
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  func fanOutReminder(event : Types.Event) : async { #Ok : Nat16; #Err : Text } {
    if (not removalReceiver.enter(event.creator)) return #Err("Event author fenced");
    try {
    await admitAccount(event.creator);
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
    } finally { removalReceiver.leave(event.creator) };
  };

  // ---- Scheduled (auto) RSVP reminders ----
  public shared ({ caller }) func set_event_auto_reminder(event_id : Text, hours_before : ?Nat16) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventFenced(event_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_event_auto_reminder(event_id : Text) : async ?{ hours_before : Nat16; sent : Bool } {
    denyLegacyAccountQuery();
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (seriesFenced(series_id)) return #Err("Club is temporarily locked for a transfer");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  func sweepAutoReminders() : async () {
    let now = nowMs();
    for (r in autoReminders.values()) {
      if (not r.sent) {
        switch (events.find(func(e) = e.id == r.event_id)) {
          case null {};
          case (?event) {
            let dueAt : Nat64 = if (event.starts_at_ms > Nat64.fromNat(Nat16.toNat(r.hours_before)) * 3_600_000) event.starts_at_ms - Nat64.fromNat(Nat16.toNat(r.hours_before)) * 3_600_000 else 0;
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
    for (assignment in eventDutyTeams.values()) {
      if (not dutyTeamReminderSent.any(func(id) = id == assignment.event_id)) {
        switch (events.find(func(e) = e.id == assignment.event_id)) {
          case null { dutyTeamReminderSent := dutyTeamReminderSent.concat([assignment.event_id]) };
          case (?event) {
            let dueAt = if (event.starts_at_ms > 86_400_000) event.starts_at_ms - 86_400_000 else (0 : Nat64);
            if (event.deleted or event.cancelled or event.starts_at_ms <= now) {
              dutyTeamReminderSent := dutyTeamReminderSent.concat([assignment.event_id]);
            } else if (now >= dueAt) {
              switch (await fanOutDutyTeamReminder(event, assignment.team_id)) {
                case (#Ok(_)) {
                  if (eventDutyTeams.any(func(item) = item.event_id == assignment.event_id and item.team_id == assignment.team_id) and not dutyTeamReminderSent.any(func(id) = id == assignment.event_id)) {
                    dutyTeamReminderSent := dutyTeamReminderSent.concat([assignment.event_id]);
                  };
                };
                case (#Err(_)) {};
              };
            };
          };
        };
      };
    };
    for (event in events.values()) {
      if (event.event_type == "game" and event.mini_league_id == null and not pointsReminderSent.any(func(id) = id == event.id)) {
        let dueAt : Nat64 = if (event.starts_at_ms > 345_600_000) event.starts_at_ms - 345_600_000 else (0 : Nat64);
        if (event.deleted or event.cancelled or event.starts_at_ms <= now) {
          pointsReminderSent := pointsReminderSent.concat([event.id]);
        } else if (now >= dueAt) {
          var recipients : [Text] = [];
          for (grant in roles.values()) {
            let going = rsvps.any(func(r) = r.event_id == event.id and r.account_id == grant.user.toText() and r.state == "going");
            if (grant.club_id == event.club_id and (grant.team_id == event.team_id or grant.team_id == null) and not going and recipients.size() < 500) {
              let user = grant.user.toText();
              if (not recipients.any(func(id) = id == user)) recipients := recipients.concat([user]);
            };
          };
          switch (await fanOutScheduledNotice(event, recipients, "Please RSVP for \"" # event.title # "\" to earn your game points", "event-points-" # event.id)) {
            case (#Ok(_)) {
              if (not pointsReminderSent.any(func(id) = id == event.id)) pointsReminderSent := pointsReminderSent.concat([event.id]);
            };
            case (#Err(_)) {};
          };
        };
      };
      if (not individualDutyReminderSent.any(func(id) = id == event.id)) {
        let dueAt : Nat64 = if (event.starts_at_ms > 86_400_000) event.starts_at_ms - 86_400_000 else (0 : Nat64);
        if (event.deleted or event.cancelled or event.starts_at_ms <= now) {
          individualDutyReminderSent := individualDutyReminderSent.concat([event.id]);
        } else if (now >= dueAt) {
          let recipients = duties
            .filter(func(d) = d.event_id == event.id and not d.completed and d.account_id != "")
            .map(func(d) = d.account_id);
          switch (await fanOutScheduledNotice(event, recipients, "Reminder: you are assigned a duty for \"" # event.title # "\"", "event-duty-individual-" # event.id)) {
            case (#Ok(_)) {
              if (not individualDutyReminderSent.any(func(id) = id == event.id)) individualDutyReminderSent := individualDutyReminderSent.concat([event.id]);
            };
            case (#Err(_)) {};
          };
        };
      };
    };
  };

  func fanOutScheduledNotice(event : Types.Event, recipients : [Text], body : Text, keyPrefix : Text) : async { #Ok : Nat16; #Err : Text } {
    if (not removalReceiver.enter(event.creator)) return #Err("Event author fenced");
    try {
    await admitAccount(event.creator);
    if (recipients.size() == 0) return #Ok(0);
    switch (notificationQueueCanister) {
      case null { #Err("Notification queue not configured") };
      case (?queueCanister) {
        let queue : actor {
          fan_out : shared ([Text], Text, Text, Text, Text, ?Text) -> async { #Ok : Nat16; #Err : Text };
        } = actor (Principal.toText(queueCanister));
        try {
          await queue.fan_out(recipients, event.club_id, "event_reminder", body, keyPrefix, ?event.id)
        } catch (_) { #Err("Scheduled reminder queue call failed") }
      };
    }
    } finally { removalReceiver.leave(event.creator) };
  };

  func fanOutDutyTeamReminder(event : Types.Event, team_id : Text) : async { #Ok : Nat16; #Err : Text } {
    if (not removalReceiver.enter(event.creator)) return #Err("Event author fenced");
    try {
    await admitAccount(event.creator);
    switch (notificationQueueCanister) {
      case null { #Err("Notification queue not configured") };
      case (?queueCanister) {
        var recipients : [Text] = [];
        for (grant in roles.values()) {
          if (grant.club_id == event.club_id and grant.team_id == ?team_id and recipients.size() < 500) {
            let accountId = grant.user.toText();
            if (not recipients.any(func(id) = id == accountId)) recipients := recipients.concat([accountId]);
          };
        };
        for (assignment in childTeamAssignments.values()) {
          if (assignment.club_id == event.club_id and assignment.team_id == team_id) {
            for (guardian in childGuardians.values()) {
              if (guardian.child_id == assignment.child_id and recipients.size() < 500 and not recipients.any(func(id) = id == guardian.guardian_id)) {
                recipients := recipients.concat([guardian.guardian_id]);
              };
            };
          };
        };
        if (recipients.size() == 0) return #Ok(0);
        let queue : actor {
          fan_out : shared ([Text], Text, Text, Text, Text, ?Text) -> async { #Ok : Nat16; #Err : Text };
        } = actor (Principal.toText(queueCanister));
        try {
          await queue.fan_out(recipients, event.club_id, "duty_reminder", "Your team is on duty for \"" # event.title # "\"", "event-duty-team-" # event.id, ?event.id)
        } catch (_) { #Err("Duty reminder queue call failed") }
      };
    }
    } finally { removalReceiver.leave(event.creator) };
  };

  func markReminderSent(event_id : Text) {
    autoReminders := autoReminders.map(func(r) { if (r.event_id == event_id) { { r with sent = true } } else r });
  };

  // ---- Post-game photo prompts ----
  // Games that ended 2–6 h ago get one "add your photos" alert to
  // members who RSVP'd going (or the whole team if nobody RSVP'd). The 6 h
  // window stops a first deploy from back-filling old games.
  func sweepPhotoPrompts() : async () {
    let nq = switch (notificationQueueCanister) { case null return; case (?id) id };
    let now = nowMs();
    let minAge : Nat64 = 2 * 3_600_000;
    let maxAge : Nat64 = 6 * 3_600_000;
    var sentThisRun = 0;
    for (event in events.values()) {
      if (sentThisRun < 20 and event.event_type == "game" and not event.deleted and not event.cancelled and event.team_id != null and event.ends_at_ms + minAge <= now and event.ends_at_ms + maxAge > now and photoPromptsSent.find(func(id) = id == event.id) == null) {
        if (not removalReceiver.enter(event.creator)) continue;
        try {
        await admitAccount(event.creator);
        photoPromptsSent := photoPromptsSent.concat([event.id]);
        sentThisRun += 1;
        var recipients : [Text] = [];
        for (r in rsvps.values()) {
          if (r.event_id == event.id and r.state == "going" and recipients.size() < 500 and recipients.find(func(x) = x == r.account_id) == null) recipients := recipients.concat([r.account_id]);
        };
        if (recipients.size() == 0) {
          for (grant in roles.values()) {
            if (grant.club_id == event.club_id and grant.team_id == event.team_id and recipients.size() < 500) {
              let a = grant.user.toText();
              if (recipients.find(func(x) = x == a) == null) recipients := recipients.concat([a]);
            };
          };
        };
        if (recipients.size() > 0) {
          let queue : actor {
            fan_out : shared ([Text], Text, Text, Text, Text, ?Text) -> async { #Ok : Nat16; #Err : Text };
          } = actor (Principal.toText(nq));
          try {
            ignore await queue.fan_out(recipients, event.club_id, "photo_prompt_reminder", "Got photos from \"" # event.title # "\"? Add them to the team gallery.", "photo-prompt-" # event.id, ?event.id);
          } catch (_) {};
        };
        } finally { removalReceiver.leave(event.creator) };
      };
    };
    if (photoPromptsSent.size() > 5000) photoPromptsSent := photoPromptsSent.sliceToArray(photoPromptsSent.size() - 5000, photoPromptsSent.size());
  };

  /// App admins: run the photo-prompt sweep now (also runs every 15 min).
  public shared ({ caller }) func run_photo_prompts() : async { #Ok : Nat; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not isGovernor(caller)) return #Err("Governor required");
    let before = photoPromptsSent.size();
    do { let removalReply = await sweepPhotoPrompts(); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    #Ok(if (photoPromptsSent.size() >= before) photoPromptsSent.size() - before else 0)
  
    } finally { removalReceiver.leave(caller) };
  };

  transient let _reminderTimer = Timer.recurringTimer<system>(#seconds(3_600), func() : async () { await sweepAutoReminders(); await sweepPhotoPrompts() });

  // Permanently removes the caller's own personal event records during
  // account erasure: their RSVPs (including mini-league RSVPs), attendance
  // marks, coach notes, event views and push-reachability rows. Shared club
  // records (events, lineups, duties, rosters) are deliberately retained.
  public shared ({ caller }) func purge_my_data() : async { #Ok : Nat32; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let me = caller.toText();
    var removed : Nat = 0;
    let keepRsvps = rsvps.filter(func(r) = r.account_id != me);
    removed += rsvps.size() - keepRsvps.size(); rsvps := keepRsvps;
    let keepAttendance = attendance.filter(func(a) = a.account_id != me);
    removed += attendance.size() - keepAttendance.size(); attendance := keepAttendance;
    let keepNotes = coachNotes.filter(func(n) = not n.updated_by.equal(caller));
    removed += coachNotes.size() - keepNotes.size(); coachNotes := keepNotes;
    let keepViews = eventViews.filter(func(v) = not v.viewer.equal(caller));
    removed += eventViews.size() - keepViews.size(); eventViews := keepViews;
    let keepReach = pushReachability.filter(func(p) = not p.user.equal(caller));
    removed += pushReachability.size() - keepReach.size(); pushReachability := keepReach;
    let keepMini = miniLeagueRsvps.filter(func(r) = switch (r.subject) { case (#account(id)) id != me; case (#mini_league_player(_)) true });
    removed += miniLeagueRsvps.size() - keepMini.size(); miniLeagueRsvps := keepMini;
    #Ok(Nat32.fromNat(removed))
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func export_state() : async { #Ok : { schema : Nat32; governor : Principal; roles : [Types.RoleGrant]; events : [Types.Event]; rsvps : [Types.Rsvp]; attendance : [Types.Attendance]; lineups : [Types.LineupEntry]; lineupSnapshots : [Types.LineupSnapshot]; duties : [Types.Duty]; roster : [Types.RosterEntry]; recurrences : [Types.Recurrence]; series : [Types.EventSeries]; eventAttendance : [Types.EventAttendance]; eventGuests : [Types.EventGuest]; children : [Types.Child]; childGuardians : [Types.ChildGuardian]; coachNotes : [Types.CoachNote]; eventViews : [Types.EventView]; reminderLogs : [Types.ReminderLog]; pushReachability : [Types.PushReachability]; eventGroups : [Types.EventGroup]; eventGroupPlayers : [Types.EventGroupPlayer]; eventGroupDuties : [Types.EventGroupDuty]; teamTrainingPauses : [Types.TeamTrainingPause]; openDuties : [Types.OpenDuty]; miniLeagueRsvps : [Types.MiniLeagueRsvp]; childTeamAssignments : [Types.ChildTeamAssignment]; eventDutyTeams : [Types.EventDutyTeam]; dutyTeamReminderSent : [Text]; pointsReminderSent : [Text]; individualDutyReminderSent : [Text]; competitionEventOperations : [Types.CompetitionEventOperation] }; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    #Ok({ schema = 8; governor; roles; events; rsvps; attendance; lineups; lineupSnapshots; duties; roster; recurrences; series; eventAttendance; eventGuests; children; childGuardians; coachNotes; eventViews; reminderLogs; pushReachability; eventGroups; eventGroupPlayers; eventGroupDuties; teamTrainingPauses; openDuties; miniLeagueRsvps; childTeamAssignments; eventDutyTeams; dutyTeamReminderSent; pointsReminderSent; individualDutyReminderSent; competitionEventOperations })
  };
  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  public shared ({ caller }) func rekey_principal(old : Principal, new_principal : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    if (removalReceiver.denied(old) or removalReceiver.denied(new_principal)) return #err("Account removal fenced");
    rekeyImpl(caller, old, new_principal, dry_run, false)
  };

  // Same as rekey_principal, but allowed when the new_principal sign-in ID already has data:
  // both IDs' records end up under the new_principal one (keyed duplicates keep the new_principal row).
  public shared ({ caller }) func merge_principal(old : Principal, new_principal : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    rekeyImpl(caller, old, new_principal, dry_run, true)
  };

  func rekeyImpl(caller : Principal, old : Principal, new_principal : Principal, dry_run : Bool, allowMerge : Bool) : { #ok : Nat; #err : Text } {
    if (removalReceiver.denied(old) or removalReceiver.denied(new_principal)) return #err("Account removal fenced");
    if (not isGovernor(caller)) return #err("Forbidden");
    if (old.equal(Principal.anonymous()) or new_principal.equal(Principal.anonymous())) return #err("Invalid principal");
    if (old.equal(new_principal)) return #err("old and new_principal must differ");
    if (old.equal(governor)) return #err("Cannot rekey the governor");
    let oldText = Principal.toText(old);
    let newText = Principal.toText(new_principal);

    // Conflict guard: count NON-EPHEMERAL records that already reference `new_principal`.
    // Ephemeral/excluded: eventViews (telemetry), pushReachability (push reachability ping).
    var conflicts = 0;
    conflicts += roles.filter(func(r) = r.user.equal(new_principal)).size();
    conflicts += events.filter(func(e) = e.creator.equal(new_principal)).size();
    conflicts += associationEvents.filter(func(a) = a.created_by.equal(new_principal)).size();
    conflicts += lineupSnapshots.filter(func(s) = s.updated_by.equal(new_principal)).size();
    conflicts += series.filter(func(s) = s.creator.equal(new_principal)).size();
    conflicts += eventAttendance.filter(func(a) = a.marked_by.equal(new_principal)).size();
    conflicts += eventGuests.filter(func(g) = g.added_by.equal(new_principal)).size();
    conflicts += coachNotes.filter(func(c) = c.updated_by.equal(new_principal)).size();
    conflicts += teamTrainingPauses.filter(func(t) = t.created_by.equal(new_principal)).size();
    conflicts += gameResults.filter(func(g) = g.saved_by.equal(new_principal)).size();
    conflicts += activeGames.filter(func(g) = g.user_id.equal(new_principal)).size();
    conflicts += (if (bulkAccessPrincipals.any(func(p) = p.equal(new_principal))) 1 else 0);
    conflicts += rsvps.filter(func(r) = r.account_id == newText).size();
    conflicts += attendance.filter(func(a) = a.account_id == newText).size();
    conflicts += duties.filter(func(d) = d.account_id == newText).size();
    conflicts += roster.filter(func(r) = r.account_id == newText).size();
    conflicts += childGuardians.filter(func(c) = c.guardian_id == newText).size();
    if (conflicts > 0 and not allowMerge) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in events_domain");

    var changed = 0;

    let rolesOld = roles.filter(func(r) = r.user.equal(old)).size();
    changed += rolesOld;
    let eventsOld = events.filter(func(e) = e.creator.equal(old)).size();
    changed += eventsOld;
    let assocOld = associationEvents.filter(func(a) = a.created_by.equal(old)).size();
    changed += assocOld;
    let lineupSnapOld = lineupSnapshots.filter(func(s) = s.updated_by.equal(old)).size();
    changed += lineupSnapOld;
    let seriesOld = series.filter(func(s) = s.creator.equal(old)).size();
    changed += seriesOld;
    let eventAttOld = eventAttendance.filter(func(a) = a.marked_by.equal(old)).size();
    changed += eventAttOld;
    let eventGuestOld = eventGuests.filter(func(g) = g.added_by.equal(old)).size();
    changed += eventGuestOld;
    let coachNoteOld = coachNotes.filter(func(c) = c.updated_by.equal(old)).size();
    changed += coachNoteOld;
    let trainingPauseOld = teamTrainingPauses.filter(func(t) = t.created_by.equal(old)).size();
    changed += trainingPauseOld;
    let gameResultOld = gameResults.filter(func(g) = g.saved_by.equal(old)).size();
    changed += gameResultOld;
    let activeGameOld = activeGames.filter(func(g) = g.user_id.equal(old)).size();
    changed += activeGameOld;
    let bulkOld = bulkAccessPrincipals.any(func(p) = p.equal(old));
    if (bulkOld) changed += 1;
    let rsvpOld = rsvps.filter(func(r) = r.account_id == oldText).size();
    changed += rsvpOld;
    let attendanceOld = attendance.filter(func(a) = a.account_id == oldText).size();
    changed += attendanceOld;
    let dutyOld = duties.filter(func(d) = d.account_id == oldText).size();
    changed += dutyOld;
    let rosterOld = roster.filter(func(r) = r.account_id == oldText).size();
    changed += rosterOld;
    let guardianOld = childGuardians.filter(func(c) = c.guardian_id == oldText).size();
    changed += guardianOld;

    // Ephemeral: push reachability — keep NEW row on conflict, drop OLD.
    let pushReachOldHas = pushReachability.any(func(p) = p.user.equal(old));
    if (pushReachOldHas) changed += 1;
    // Ephemeral: event views — keep NEW (event_id, viewer) row on conflict, drop OLD.
    let eventViewOldCount = eventViews.filter(func(v) = v.viewer.equal(old)).size();
    if (eventViewOldCount > 0) changed += eventViewOldCount;

    if (not dry_run) {
      if (rolesOld > 0) roles := roles.map(func(r) = if (r.user.equal(old)) ({ r with user = new_principal }) else r);
      if (eventsOld > 0) events := events.map(func(e) = if (e.creator.equal(old)) ({ e with creator = new_principal }) else e);
      if (assocOld > 0) associationEvents := associationEvents.map(func(a) = if (a.created_by.equal(old)) ({ a with created_by = new_principal }) else a);
      if (lineupSnapOld > 0) lineupSnapshots := lineupSnapshots.map(func(s) = if (s.updated_by.equal(old)) ({ s with updated_by = new_principal }) else s);
      if (seriesOld > 0) series := series.map(func(s) = if (s.creator.equal(old)) ({ s with creator = new_principal }) else s);
      if (eventAttOld > 0) eventAttendance := eventAttendance.map(func(a) = if (a.marked_by.equal(old)) ({ a with marked_by = new_principal }) else a);
      if (eventGuestOld > 0) eventGuests := eventGuests.map(func(g) = if (g.added_by.equal(old)) ({ g with added_by = new_principal }) else g);
      if (coachNoteOld > 0) coachNotes := coachNotes.map(func(c) = if (c.updated_by.equal(old)) ({ c with updated_by = new_principal }) else c);
      if (trainingPauseOld > 0) teamTrainingPauses := teamTrainingPauses.map(func(t) = if (t.created_by.equal(old)) ({ t with created_by = new_principal }) else t);
      if (gameResultOld > 0) gameResults := gameResults.map(func(g) = if (g.saved_by.equal(old)) ({ g with saved_by = new_principal }) else g);
      if (activeGameOld > 0) activeGames := activeGames.map(func(g) = if (g.user_id.equal(old)) ({ g with user_id = new_principal }) else g);
      if (bulkOld) bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(old)).concat([new_principal]);
      if (rsvpOld > 0) rsvps := rsvps.map(func(r) = if (r.account_id == oldText) ({ r with account_id = newText }) else r);
      if (attendanceOld > 0) attendance := attendance.map(func(a) = if (a.account_id == oldText) ({ a with account_id = newText }) else a);
      if (dutyOld > 0) duties := duties.map(func(d) = if (d.account_id == oldText) ({ d with account_id = newText }) else d);
      if (rosterOld > 0) roster := roster.map(func(r) = if (r.account_id == oldText) ({ r with account_id = newText }) else r);
      if (guardianOld > 0) childGuardians := childGuardians.map(func(c) = if (c.guardian_id == oldText) ({ c with guardian_id = newText }) else c);

      if (pushReachOldHas) {
        let newHas = pushReachability.any(func(p) = p.user.equal(new_principal));
        if (newHas) {
          pushReachability := pushReachability.filter(func(p) = not p.user.equal(old));
        } else {
          pushReachability := pushReachability.map(func(p) = if (p.user.equal(old)) ({ p with user = new_principal }) else p);
        };
      };
      if (eventViewOldCount > 0) {
        eventViews := eventViews.filter(func(v) = not (v.viewer.equal(old) and eventViews.any(func(w) = w.event_id == v.event_id and w.viewer.equal(new_principal))))
          .map(func(v) = if (v.viewer.equal(old)) ({ v with viewer = new_principal }) else v);
      };
    };

    #ok(changed)
  };



  // Additive protected consensus reads; live UI rollout is a separate release gate.
  public shared ({ caller }) func read_account_execute(input : Text) : async Oql.Result {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let request = Oql.parse(input, [OqlEvents.entity]);
    Oql.run<Types.Event>(request, events, func(event) = not event.deleted and canView(caller, event), OqlEvents.row)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_association_events(association_id : Text) : async { #Ok : [Types.AssociationEvent]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let allowed = isGovernor(caller) or hasBulkAccess(caller) or hasRole(caller, "club_admin", association_id, null);
    if (not allowed) return #Err("Association admin required");
    #Ok(associationEvents.filter(func(a) = a.association_id == association_id and not a.deleted))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_child(event_id : Text, child_id : Text) : async { #Ok : Types.Child; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_series(club_id : ?Text, team_id : ?Text) : async [Types.EventSeries] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    series.filter(func(item) =
      not item.deleted
        and canViewSeries(caller, item)
        and (club_id == null or club_id == ?item.club_id)
        and (team_id == null or team_id == item.team_id)
    )
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_series_occurrences(series_id : Text) : async { #Ok : [{ id : Text; starts_at_ms : Nat64; ends_at_ms : Nat64; deleted : Bool }]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (series.find(func(item) = item.id == series_id)) {
      case null { #Err("Series not found") };
      case (?item) {
        if (not canViewSeries(caller, item)) return #Err("Forbidden");
        let occurrences = events.filter(func(e) = e.series_id == ?series_id);
        let sorted = occurrences.sort(func(a, b) = Nat64.compare(a.starts_at_ms, b.starts_at_ms));
        #Ok(sorted.map(func(e) = { id = e.id; starts_at_ms = e.starts_at_ms; ends_at_ms = e.ends_at_ms; deleted = e.deleted }));
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_lineup_snapshot(event_id : Text, team_id : ?Text) : async { #Ok : ?Types.LineupSnapshot; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(lineupSnapshots.find(func(item) = item.event_id == event_id and item.team_id == team_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_sponsors(event_id : Text) : async { #Ok : [Text]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (eventSponsors.find(func((id, _)) = id == event_id)) { case (?(_, ids)) #Ok(ids); case null #Ok([]) };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_timer(event_id : Text) : async { #Ok : ?Types.EventTimer; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(eventTimers.find(func(item) = item.event_id == event_id))
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_roster(event_id : Text) : async { #Ok : [Types.RosterEntry]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(roster.filter(func(item) = item.event_id == event_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_events(club_id : ?Text, team_id : ?Text) : async [Types.Event] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    var visible : [Types.Event] = [];
    for (event in events.values()) {
      if (not event.deleted and (club_id == null or club_id == ?event.club_id) and (team_id == null or team_id == event.team_id)) {
        if (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    }) visible := visible.concat([event]);
      };
    };
    visible
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_events_multi(club_ids : [Text], team_ids : [Text]) : async { #Ok : [Types.Event]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (club_ids.size() + team_ids.size() > 300) return #Err("Too many ids");
    var visible : [Types.Event] = [];
    for (event in events.values()) {
      if (not event.deleted and (club_ids.any(func(c) = c == event.club_id) or (switch (event.team_id) { case (?t) team_ids.any(func(id) = id == t); case null false }))) {
        if (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    }) visible := visible.concat([event]);
      };
    };
    #Ok(visible)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_events_for_duty_teams(team_ids : [Text]) : async { #Ok : [Types.Event]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (team_ids.size() > 100) return #Err("Too many duty teams");
    #Ok(events.filter(func(event) =
      not event.deleted and canView(caller, event) and
      eventDutyTeams.any(func(assignment) = assignment.event_id == event.id and team_ids.any(func(id) = id == assignment.team_id))
    ))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_rosters(event_ids : [Text]) : async { #Ok : [Types.RosterEntry]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (event_ids.size() > 300) return #Err("Too many ids");
    let ok = visibleEventIds(caller, event_ids);
    #Ok(roster.filter(func(item) = ok.any(func(i) = i == item.event_id)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_duties_multi(event_ids : [Text]) : async { #Ok : [Types.Duty]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (event_ids.size() > 300) return #Err("Too many ids");
    let ok = visibleEventIds(caller, event_ids);
    #Ok(duties.filter(func(item) = ok.any(func(i) = i == item.event_id)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_my_rsvps() : async [Types.Rsvp] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let accountId = Principal.toText(caller);
    rsvps.filter(func(item) = item.account_id == accountId)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_attendance(event_id : Text) : async { #Ok : [Types.EventAttendance]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(eventAttendance.filter(func(item) = item.event_id == event_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_my_attendance(event_id : ?Text) : async [Types.EventAttendance] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let accountId = Principal.toText(caller);
    eventAttendance.filter(func(item) = item.subject_id == accountId and (event_id == null or event_id == ?item.event_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_event_roster(event_id : Text) : async { #Ok : Types.EventRoster; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_my_child_rsvps(event_id : ?Text, club_id : ?Text) : async [Types.RsvpWithChild] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_child_is_in_event_audience(child_id : Text, event_id : Text) : async { #Ok : Bool; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(e) = e.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        let hasRsvp = rsvps.any(func(r) = r.event_id == event_id and r.child_id == ?child_id);
        let guardianIsMember = childGuardians.any(func(g) = g.child_id == child_id and isClubMemberText(g.guardian_id, event.club_id));
        #Ok(hasRsvp or guardianIsMember)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_rsvp_created_at(event_id : Text, account_id : Text) : async ?Nat64 {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (rsvpCreatedAt.find(func(item) = item.event_id == event_id and item.account_id == account_id)) {
      case null null;
      case (?item) ?item.created_at_ms;
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_favourite_event_titles() : async [Text] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let me = callerAccountId(caller);
    favouriteEventTitles.filter(func(item) = item.account_id == me).map(func(item) = item.title);
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_saved_locations() : async [Types.SavedLocation] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let me = callerAccountId(caller);
    savedLocations.filter(func(item) = item.account_id == me);
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_training_default(club_id : Text, team_id : Text, child_id : ?Text) : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(club_id) or not valid(team_id)) return #Err("Invalid training default lookup");
    let me = callerAccountId(caller);
    switch (trainingDefaults.find(func(item) = item.account_id == me and item.club_id == club_id and item.team_id == team_id and item.child_id == child_id)) {
      case null { #Ok(null) };
      case (?item) { #Ok(?item.default_rsvp) };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_coach_note(event_id : Text) : async { #Ok : ?Types.CoachNote; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(coachNotes.find(func(item) = item.event_id == event_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_read_event_club(event_id : Text) : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (Principal.isAnonymous(caller)) return #Err("Sign in required");
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Ok(null) };
      case (?event) { if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    })) #Err("Forbidden") else #Ok(?event.club_id) };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_view_count(event_id : Text) : async { #Ok : Nat32; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(Nat.toNat32(eventViews.filter(func(item) = item.event_id == event_id).size()))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_reminders(event_id : Text) : async { #Ok : [Types.ReminderLog]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (requireManage(caller, event_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
    #Ok(reminderLogs.filter(func(item) = item.event_id == event_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_push_reachable(principal : Principal) : async { #Ok : ?Bool; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(switch (pushReachability.find(func(item) = item.user.equal(principal))) { case (?item) ?item.reachable; case null null })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_reminder_log(event_id : Text) : async { #Ok : { sent_at_ms : ?Nat64; recipients_count : Nat32 }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_is_reachable(account_id : Text) : async { #Ok : Bool; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(pushReachability.any(func(item) = Principal.toText(item.user) == account_id and item.reachable))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_event_groups(event_id : Text) : async { #Ok : [Types.EventGroup]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    })) return #Err("Forbidden"); #Ok(eventGroups.filter(func(item) = item.event_id == event_id)) };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_group_players(group_id : Text) : async { #Ok : [Types.EventGroupPlayer]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (eventGroups.find(func(item) = item.id == group_id)) {
      case null { #Err("Group not found") };
      case (?group) {
        switch (events.find(func(item) = item.id == group.event_id)) {
          case null { #Err("Event not found") };
          case (?event) { if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    })) return #Err("Forbidden"); #Ok(eventGroupPlayers.filter(func(item) = item.group_id == group_id)) };
        };
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_group(group_id : Text) : async { #Ok : ?Types.EventGroup; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let group = switch (eventGroups.find(func(g) = g.id == group_id)) { case null return #Ok(null); case (?g) g };
    let event = switch (events.find(func(e) = e.id == group.event_id)) { case null return #Ok(null); case (?e) e };
    if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    })) return #Err("Forbidden");
    #Ok(?group)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_read_event_group_club(group_id : Text) : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let group = switch (eventGroups.find(func(g) = g.id == group_id)) { case null return #Ok(null); case (?g) g };
    let event = switch (events.find(func(e) = e.id == group.event_id)) { case null return #Ok(null); case (?e) e };
    #Ok(if ((if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    })) ?event.club_id else null)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_group_edit_access(group_id : Text) : async { #Ok : Bool; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let group = switch (eventGroups.find(func(g) = g.id == group_id)) { case null return #Err("Group not found"); case (?g) g };
    let event = switch (events.find(func(e) = e.id == group.event_id)) { case null return #Err("Event not found"); case (?e) e };
    #Ok((if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    }) and canEditGroupState(caller, group))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_group_duties(group_id : Text) : async { #Ok : [Types.EventGroupDuty]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (eventGroups.find(func(item) = item.id == group_id)) {
      case null { #Err("Group not found") };
      case (?group) {
        switch (events.find(func(item) = item.id == group.event_id)) {
          case null { #Err("Event not found") };
          case (?event) { if (not (if (Principal.isAnonymous(caller) or event.deleted) false else if (canView(caller, event)) true else switch (event.mini_league_id, miniLeagueDomainCanister) {
      case (?leagueId, ?authority) {
        let ml : actor { can_read_league_matches : shared query (Principal, Text, Text) -> async Bool } = actor (authority.toText());
        try { do { let removalReply = await ml.can_read_league_matches(caller, leagueId, event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false }
      };
      case _ false;
    })) return #Err("Forbidden"); #Ok(eventGroupDuties.filter(func(item) = item.group_id == group_id)) };
        };
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_team_training_pauses(club_id : Text, team_id : Text) : async { #Ok : [Types.TeamTrainingPause]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not isClubMember(caller, club_id) and not managesTeam(caller, club_id, team_id)) return #Err("Forbidden");
    #Ok(teamTrainingPauses.filter(func(item) = item.club_id == club_id and item.team_id == team_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_is_paused(club_id : Text, team_id : Text, at_ms : Nat64) : async { #Ok : Bool; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not isClubMember(caller, club_id) and not managesTeam(caller, club_id, team_id)) return #Err("Forbidden");
    #Ok(teamTrainingPauses.any(func(item) = item.club_id == club_id and item.team_id == team_id and item.starts_at_ms <= at_ms and at_ms <= item.ends_at_ms))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_is_team_member(principal : Principal, club_id : Text, team_id : Text) : async Bool {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    roles.any(func(grant) = grant.user.equal(principal) and grant.club_id == club_id and (grant.team_id == ?team_id or grant.team_id == null))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_is_guardian_of(principal : Principal, child_id : Text) : async Bool {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    childGuardians.any(func(item) = item.child_id == child_id and item.guardian_id == Principal.toText(principal))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_open_duties(event_id : Text) : async { #Ok : [Types.OpenDuty]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(openDuties.filter(func(item) = item.event_id == event_id)) };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_duties(event_id : Text) : async { #Ok : [Types.Duty]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(duties.filter(func(item) = item.event_id == event_id)) };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_my_children() : async [Types.Child] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let callerId = Principal.toText(caller);
    let guardedIds = childGuardians.filter(func(g) = g.guardian_id == callerId).map(func(g) = g.child_id);
    children.filter(func(c) = (c.parent_id == ?callerId) or guardedIds.any(func(id) = id == c.id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_child_team_assignments(club_id : Text, team_id : Text) : async { #Ok : [Types.ChildTeamAssignment]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not isClubMember(caller, club_id)) return #Err("Forbidden");
    #Ok(childTeamAssignments.filter(func(item) = item.club_id == club_id and item.team_id == team_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_my_child_team_assignments(child_id : Text) : async { #Ok : [Types.ChildTeamAssignment]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let callerId = Principal.toText(caller);
    let isMyChild = childGuardians.any(func(g) = g.child_id == child_id and g.guardian_id == callerId)
      or children.any(func(c) = c.id == child_id and c.parent_id == ?callerId);
    if (not isMyChild and not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Forbidden");
    #Ok(childTeamAssignments.filter(func(item) = item.child_id == child_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_mini_league_rsvps(event_id : Text) : async { #Ok : [Types.MiniLeagueRsvp]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) { if (not canView(caller, event)) return #Err("Forbidden"); #Ok(miniLeagueRsvps.filter(func(item) = item.event_id == event_id)) };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_pitch_board_settings(team_id : Text) : async { #Ok : ?Types.PitchBoardSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(pitchBoardSettings.find(func(item) = item.team_id == team_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_game_summary(event_id : Text) : async { #Ok : ?Types.GameSummary; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let event=switch(events.find(func(e)=e.id==event_id and not e.deleted)){case null return #Err("Event not found");case(?e)e};
    do { let removalReply = await syncRolesFromClubDomain(caller,event.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if(not (do { let removalReply = await* canViewMatch(caller,event); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) or eventFenced(event_id)) return #Err("Event access forbidden");
    #Ok(gameSummaries.find(func(item) = item.event_id == event_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_game_player_stats(event_id : Text) : async { #Ok : [Types.GamePlayerStat]; #Err : Text } {
    await protectedPlayerStats(caller,event_id)
  };

  public shared ({ caller }) func read_account_get_game_result(event_id : Text) : async { #Ok : ?HistoryPrivacy.Read; #Err : Text } {
    await historyResult(caller,event_id)
  };

  public shared ({ caller }) func read_account_list_match_captains(event_id : Text) : async { #Ok : [Types.MatchCaptainAssignment]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(matchCaptainAssignments.filter(func(item) = item.event_id == event_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_match_goalkeepers(event_id : Text) : async { #Ok : [Types.MatchGoalkeeperAssignment]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(matchGoalkeeperAssignments.filter(func(item) = item.event_id == event_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_player_stats_report(club_id : Text, team_id : ?Text, from_ms : Nat64, to_ms : Nat64) : async { #Ok : [Types.PlayerStatRow]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(club_id)) return #Err("Invalid club");
    let teamAllowed = switch (team_id) { case (?t) managesTeam(caller, club_id, t); case null false };
    if (not isGovernor(caller) and not hasRole(caller, "club_admin", club_id, null) and not teamAllowed) return #Err("Team staff required");
    let matchingEvents = events.filter(func(e) = e.club_id == club_id and not e.deleted and e.starts_at_ms >= from_ms and e.starts_at_ms <= to_ms and (switch (team_id) { case (?t) e.team_id == ?t; case null true }));
    let eventIds = matchingEvents.map(func(e) = e.id);
    var rows : [Types.PlayerStatRow] = [];
    for (cap in matchCaptainAssignments.values()) {
      if (eventIds.any(func(id) = id == cap.event_id)) {
        if (cap.role == "captain") { rows := bumpPlayerStat(rows, cap.ref_kind, cap.ref_id, 0, 1, 0, 0) }
        else { rows := bumpPlayerStat(rows, cap.ref_kind, cap.ref_id, 0, 0, 1, 0) };
      };
    };
    for (gk in matchGoalkeeperAssignments.values()) {
      if (eventIds.any(func(id) = id == gk.event_id)) {
        rows := bumpPlayerStat(rows, gk.ref_kind, gk.ref_id, 0, 0, 0, 1);
      };
    };
    for (gr in gameResults.values()) {
      switch (gr.event_id) {
        case (?eid) {
          if (eventIds.any(func(id) = id == eid)) {
            switch (gr.mvp_player_id) {
              case (?pid) { rows := bumpPlayerStat(rows, "account", pid, 1, 0, 0, 0) };
              case null {};
            };
          };
        };
        case null {};
      };
    };
    #Ok(rows)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_active_game(team_id : ?Text) : async { #Ok : ?Types.ActiveGame; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(activeGames.find(func(item) = item.is_active and (switch (team_id) { case (?t) item.team_id == ?t; case null item.user_id.equal(caller) and item.team_id == null })))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_event_views(event_id : Text) : async { #Ok : [Types.EventView]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (requireManage(caller, event_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(eventViews.filter(func(item) = item.event_id == event_id));
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_my_viewed_event_ids(event_ids : [Text]) : async { #Ok : [Text]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(event_ids.filter(func(id) = eventViews.any(func(item) = item.event_id == id and item.viewer.equal(caller))))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_check_event_membership(user_id : Text, event_id : Text) : async Bool {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_playhq_config_status() : async { #Ok : { configured : Bool; base_url : ?Text; updated_at_ms : ?Nat64 }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not isGovernor(caller)) return #Err("Governor only");
    switch (playHQConfig) {
      case null #Ok({ configured = false; base_url = null; updated_at_ms = null });
      case (?c) #Ok({ configured = true; base_url = ?c.base_url; updated_at_ms = ?c.updated_at_ms });
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_playhq_team_sync(team_id : Text) : async { #Ok : ?Types.PlayHQTeamSync; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(playhqTeamSyncs.find(func(s) = s.team_id == team_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_duty_team(event_id : Text) : async { #Ok : ?Types.EventDutyTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (events.find(func(item) = item.id == event_id)) {
      case null { #Err("Event not found") };
      case (?event) {
        if (not canView(caller, event)) return #Err("Forbidden");
        #Ok(eventDutyTeams.find(func(item) = item.event_id == event_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_event_duty_teams(event_ids : [Text]) : async { #Ok : [Types.EventDutyTeam]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (event_ids.size() > 300) return #Err("Too many event ids");
    let visibleIds = visibleEventIds(caller, event_ids);
    #Ok(eventDutyTeams.filter(func(item) = visibleIds.any(func(id) = id == item.event_id)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_event_auto_reminder(event_id : Text) : async ?{ hours_before : Nat16; sent : Bool } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
  
    } finally { removalReceiver.leave(caller) };
  };
};
