import Array "mo:core/Array";
import Float "mo:core/Float";
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
  var webVitals : [Types.WebVital];
  var perfSamples : [Types.PerfSample];
  var engagementCounters : [Types.EngagementCounter];
  var adminAlerts : [Types.AdminAlert];
  var auditLogs : [Types.AuditLog];
  var feedback : [Types.Feedback];
  var nextId : Nat64;

  let MAX_BATCH = 50;

  func auth(caller : Principal) { if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required") };
  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };
  func freshId(prefix : Text) : Text { let id = prefix # "-" # Nat64.toText(nextId); nextId += 1; id };
  func valid(value : Text) : Bool { value != "" and value.size() <= 256 };

  func isGovernor(caller : Principal) : Bool { not caller.equal(Principal.anonymous()) and governor.equal(caller) };
  func hasRole(caller : Principal, role : Text, club : ?Text) : Bool {
    roles.any(func(grant) = grant.user.equal(caller) and grant.role == role and (club == null or club == ?grant.club_id))
  };
  func isAppAdmin(caller : Principal) : Bool { isGovernor(caller) or hasRole(caller, "app_admin", null) };
  func isClubAdmin(caller : Principal, club_id : Text) : Bool { isAppAdmin(caller) or hasRole(caller, "club_admin", ?club_id) };

  // ---------- day bucketing (UTC, integer division; no calendar libs) ----------
  func dayKey(ms : Nat64) : Text { Nat64.toText(ms / 86_400_000) };

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
    #Ok
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(club_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.club_id == club_id and item.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    };
    #Ok
  };

  // ================= Perf / analytics ingest =================

  public shared ({ caller }) func record_web_vital(metric_name : Text, metric_value : Float, rating : Text, page_path : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(metric_name) or not valid(page_path)) return #Err("Invalid web vital");
    webVitals := webVitals.concat([{ id = freshId("wv"); user = caller; metric_name; metric_value; rating; page_path; created_at_ms = nowMs() }]);
    #Ok
  };

  public type PerfSampleInput = { surface : Text; source : Text; duration_ms : Nat32; cache_hit : Bool; platform : Text };

  public shared ({ caller }) func record_perf_sample(surface : Text, source : Text, duration_ms : Nat32, cache_hit : Bool, platform : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(surface) or not valid(source)) return #Err("Invalid perf sample");
    perfSamples := perfSamples.concat([{ surface; user = caller; source; duration_ms; cache_hit; platform; created_at_ms = nowMs() }]);
    #Ok
  };

  // Bounded batch variant so a single client flush (e.g. beforeunload) can
  // ship several buffered samples in one call instead of one round trip
  // each; caps at MAX_BATCH to bound message size like create_series' 366 cap.
  public shared ({ caller }) func record_perf_samples_batch(samples : [PerfSampleInput]) : async { #Ok : Nat32; #Err : Text } {
    auth(caller);
    if (samples.size() == 0) return #Err("Empty batch");
    if (samples.size() > MAX_BATCH) return #Err("Batch too large");
    for (item in samples.values()) { if (not valid(item.surface) or not valid(item.source)) return #Err("Invalid perf sample in batch") };
    let now = nowMs();
    let rows = samples.map(func(item : PerfSampleInput) : Types.PerfSample = { surface = item.surface; user = caller; source = item.source; duration_ms = item.duration_ms; cache_hit = item.cache_hit; platform = item.platform; created_at_ms = now });
    perfSamples := perfSamples.concat(rows);
    #Ok(Nat.toNat32(rows.size()))
  };

  func percentile(sorted : [Nat32], p : Float) : Nat32 {
    if (sorted.size() == 0) return 0;
    let rank = Float.toInt(Float.ceil(p * Float.fromInt(sorted.size()))) - 1;
    let index = Nat.max(0, Nat.min(sorted.size() - 1, Int.abs(rank)));
    sorted[index]
  };

  // Avg/p50/p95 duration for a surface (optionally filtered by source) over
  // [since_ms, until_ms). Mirrors the per-surface dashboards (home/inbox/chat/
  // schedule open perf, realtime + generic client perf log).
  public query ({ caller }) func perf_aggregate(surface : Text, source : ?Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : Types.PerfAggregate; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    let matches = perfSamples.filter(func(item) =
      item.surface == surface and (source == null or source == ?item.source) and item.created_at_ms >= since_ms and item.created_at_ms < until_ms
    );
    if (matches.size() == 0) return #Ok({ surface; source = switch (source) { case (?s) s; case null "" }; count = 0; avg_ms = 0.0; p50_ms = 0; p95_ms = 0 });
    let durations = matches.map(func(item) = item.duration_ms);
    let sorted = durations.sort(func(a, b) = Nat32.compare(a, b));
    let total = durations.foldLeft(0.0, func(acc, item) = acc + Float.fromInt(Nat32.toNat(item)));
    #Ok({
      surface; source = switch (source) { case (?s) s; case null "" };
      count = Nat.toNat32(matches.size());
      avg_ms = total / Float.fromInt(matches.size());
      p50_ms = percentile(sorted, 0.5);
      p95_ms = percentile(sorted, 0.95);
    })
  };

  // ================= Engagement counters =================

  func bumpCounter(club_id : Text, day : Text, kind : Types.EngagementEventKind, byUser : ?Text) {
    let existing = engagementCounters.find(func(item) = item.club_id == club_id and item.day == day and item.kind == kind);
    switch (existing) {
      case (?current) {
        let activeUsers = switch (byUser) {
          case (?user) { if (current.activeUsers.any(func(u) = u == user)) current.activeUsers else current.activeUsers.concat([user]) };
          case null current.activeUsers;
        };
        let updated = { current with count = current.count + 1; activeUsers };
        engagementCounters := engagementCounters.map(func(item) = if (item.club_id == club_id and item.day == day and item.kind == kind) updated else item);
      };
      case null {
        let activeUsers = switch (byUser) { case (?user) [user]; case null [] };
        engagementCounters := engagementCounters.concat([{ club_id; day; kind; count = 1; activeUsers }]);
      };
    };
  };

  public shared ({ caller }) func record_message_sent(club_id : Text, account_id : Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not valid(club_id)) return #Err("Invalid club");
    let day = dayKey(nowMs());
    bumpCounter(club_id, day, #Message, null);
    bumpCounter(club_id, day, #ActiveUser, ?account_id);
    #Ok
  };

  public shared ({ caller }) func record_rsvp_completed(club_id : Text, account_id : Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not valid(club_id)) return #Err("Invalid club");
    let day = dayKey(nowMs());
    bumpCounter(club_id, day, #Rsvp, null);
    bumpCounter(club_id, day, #ActiveUser, ?account_id);
    #Ok
  };

  public shared ({ caller }) func record_active_user(club_id : Text, account_id : Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not valid(club_id) or not valid(account_id)) return #Err("Invalid input");
    bumpCounter(club_id, dayKey(nowMs()), #ActiveUser, ?account_id);
    #Ok
  };

  public shared ({ caller }) func record_sponsor_impression(club_id : Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not valid(club_id)) return #Err("Invalid club");
    bumpCounter(club_id, dayKey(nowMs()), #SponsorImpression, null);
    #Ok
  };

  public shared ({ caller }) func record_sponsor_click(club_id : Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not valid(club_id)) return #Err("Invalid club");
    bumpCounter(club_id, dayKey(nowMs()), #SponsorClick, null);
    #Ok
  };

  func kindEq(a : Types.EngagementEventKind, b : Types.EngagementEventKind) : Bool { a == b };

  func totalsFor(club_id : Text, since_ms : Nat64, until_ms : Nat64) : Types.EngagementTotals {
    let inRange = engagementCounters.filter(func(item) =
      item.club_id == club_id and item.day >= dayKey(since_ms) and item.day <= dayKey(until_ms)
    );
    func sumKind(kind : Types.EngagementEventKind) : Nat32 { inRange.filter(func(item) = kindEq(item.kind, kind)).foldLeft(0 : Nat32, func(acc, item) = acc + item.count) };
    let activeUserSet = inRange.filter(func(item) = kindEq(item.kind, #ActiveUser)).foldLeft([] : [Text], func(acc, item) = item.activeUsers.foldLeft(acc, func(a, u) = if (a.any(func(x) = x == u)) a else a.concat([u])));
    {
      club_id;
      messages = sumKind(#Message);
      rsvps = sumKind(#Rsvp);
      active_users = Nat.toNat32(activeUserSet.size());
      sponsor_impressions = sumKind(#SponsorImpression);
      sponsor_clicks = sumKind(#SponsorClick);
    }
  };

  // Mirrors club_engagement_totals: aggregate counts for a club over a window.
  public query ({ caller }) func club_engagement_totals(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : Types.EngagementTotals; #Err : Text } {
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(totalsFor(club_id, since_ms, until_ms))
  };

  // Mirrors club_engagement_benchmarks: current window vs. a prior window of
  // the same club for trend comparison.
  public query ({ caller }) func club_engagement_benchmarks(club_id : Text, since_ms : Nat64, until_ms : Nat64, prev_since_ms : Nat64, prev_until_ms : Nat64) : async { #Ok : Types.EngagementBenchmarks; #Err : Text } {
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok({ club_id; current = totalsFor(club_id, since_ms, until_ms); previous = totalsFor(club_id, prev_since_ms, prev_until_ms) })
  };

  func seriesFor(club_id : Text, kind : Types.EngagementEventKind, since_ms : Nat64, until_ms : Nat64) : [Types.EngagementDayPoint] {
    let inRange = engagementCounters.filter(func(item) =
      item.club_id == club_id and kindEq(item.kind, kind) and item.day >= dayKey(since_ms) and item.day <= dayKey(until_ms)
    );
    inRange.map(func(item) = { day = item.day; value = item.count }).sort(func(a, b) = if (a.day == b.day) #equal else if (a.day < b.day) #less else #greater)
  };

  // Mirrors club_engagement_message_volume: daily message counts.
  public query ({ caller }) func club_engagement_message_volume(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : [Types.EngagementDayPoint]; #Err : Text } {
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(seriesFor(club_id, #Message, since_ms, until_ms))
  };

  // Mirrors club_engagement_rsvp_completion_series: daily RSVP counts.
  public query ({ caller }) func club_engagement_rsvp_completion_series(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : [Types.EngagementDayPoint]; #Err : Text } {
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(seriesFor(club_id, #Rsvp, since_ms, until_ms))
  };

  // Mirrors club_engagement_active_users: daily distinct-active-user counts.
  public query ({ caller }) func club_engagement_active_users(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : [Types.EngagementDayPoint]; #Err : Text } {
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    let inRange = engagementCounters.filter(func(item) = item.club_id == club_id and kindEq(item.kind, #ActiveUser) and item.day >= dayKey(since_ms) and item.day <= dayKey(until_ms));
    #Ok(inRange.map(func(item) = { day = item.day; value = Nat.toNat32(item.activeUsers.size()) }).sort(func(a, b) = if (a.day == b.day) #equal else if (a.day < b.day) #less else #greater))
  };

  // Mirrors club_engagement_sponsor_performance: daily impressions/clicks.
  public query ({ caller }) func club_engagement_sponsor_performance(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : { impressions : [Types.EngagementDayPoint]; clicks : [Types.EngagementDayPoint] }; #Err : Text } {
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok({ impressions = seriesFor(club_id, #SponsorImpression, since_ms, until_ms); clicks = seriesFor(club_id, #SponsorClick, since_ms, until_ms) })
  };

  // Mirrors club_engagement_total_unique_reach: distinct active users across
  // the whole window (not summed per-day).
  public query ({ caller }) func club_engagement_total_unique_reach(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : Nat32; #Err : Text } {
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(totalsFor(club_id, since_ms, until_ms).active_users)
  };

  // ================= Admin alerts =================

  public shared ({ caller }) func create_admin_alert(alert_type : Text, details : Text) : async { #Ok : Types.AdminAlert; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    if (not valid(alert_type)) return #Err("Invalid alert");
    let value : Types.AdminAlert = { id = freshId("alert"); alert_type; details; status = #Open; created_at_ms = nowMs(); resolved_at_ms = null; resolved_by = null };
    adminAlerts := adminAlerts.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func list_admin_alerts(status : ?Types.AlertStatus) : async { #Ok : [Types.AdminAlert]; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    #Ok(adminAlerts.filter(func(item) = status == null or status == ?item.status))
  };

  public shared ({ caller }) func resolve_admin_alert(id : Text) : async { #Ok : Types.AdminAlert; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    switch (adminAlerts.find(func(item) = item.id == id)) {
      case null { #Err("Alert not found") };
      case (?current) {
        let updated = { current with status = #Resolved; resolved_at_ms = ?nowMs(); resolved_by = ?caller };
        adminAlerts := adminAlerts.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  // ================= Audit logs =================

  public shared ({ caller }) func append_audit_log(action_type : Text, table_name : Text, target_user_id : ?Text, target_user_name : ?Text, details : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(action_type)) return #Err("Invalid audit log");
    auditLogs := auditLogs.concat([{ id = freshId("audit"); action_type; actor_id = caller; target_user_id; target_user_name; details; table_name; created_at_ms = nowMs() }]);
    #Ok
  };

  // Paginated, optionally filtered by actor and/or action_type/table_name.
  public query ({ caller }) func list_audit_logs(actor_filter : ?Principal, action_type : ?Text, table_name : ?Text, offset : Nat32, limit : Nat32) : async { #Ok : { items : [Types.AuditLog]; total : Nat32 }; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    let boundedLimit = Nat32.min(limit, 200);
    let matches = auditLogs.filter(func(item) =
      (actor_filter == null or (switch (actor_filter) { case (?a) a.equal(item.actor_id); case null true }))
        and (action_type == null or action_type == ?item.action_type)
        and (table_name == null or table_name == ?item.table_name)
    );
    let start = Nat.min(Nat32.toNat(offset), matches.size());
    let end = Nat.min(start + Nat32.toNat(boundedLimit), matches.size());
    #Ok({ items = matches.sliceToArray(start, end); total = Nat.toNat32(matches.size()) })
  };

  // ================= Feedback =================

  public shared ({ caller }) func submit_feedback(kind : Text, title : ?Text, message : Text, page_url : ?Text) : async { #Ok : Types.Feedback; #Err : Text } {
    auth(caller);
    if (not valid(kind) or message == "" or message.size() > 4000) return #Err("Invalid feedback");
    let now = nowMs();
    let value : Types.Feedback = { id = freshId("fb"); user = caller; kind; title; message; page_url; status = #Open; admin_notes = null; created_at_ms = now; updated_at_ms = now };
    feedback := feedback.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func my_feedback() : async [Types.Feedback] {
    auth(caller);
    feedback.filter(func(item) = item.user.equal(caller))
  };

  public query ({ caller }) func list_feedback(status : ?Types.FeedbackStatus, offset : Nat32, limit : Nat32) : async { #Ok : { items : [Types.Feedback]; total : Nat32 }; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    let boundedLimit = Nat32.min(limit, 200);
    let matches = feedback.filter(func(item) = status == null or status == ?item.status);
    let start = Nat.min(Nat32.toNat(offset), matches.size());
    let end = Nat.min(start + Nat32.toNat(boundedLimit), matches.size());
    #Ok({ items = matches.sliceToArray(start, end); total = Nat.toNat32(matches.size()) })
  };

  public shared ({ caller }) func update_feedback_status(id : Text, status : Types.FeedbackStatus, admin_notes : ?Text) : async { #Ok : Types.Feedback; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    switch (feedback.find(func(item) = item.id == id)) {
      case null { #Err("Feedback not found") };
      case (?current) {
        let updated = { current with status; admin_notes; updated_at_ms = nowMs() };
        feedback := feedback.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };
}
