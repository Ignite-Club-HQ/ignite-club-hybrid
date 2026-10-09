import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Float "mo:core/Float";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "types";

persistent actor class Main(governorInit : Principal) {
  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };

  var governor : Principal;

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };
  var roles : [Types.RoleGrant];
  var webVitals : [Types.WebVital];
  var perfSamples : [Types.PerfSample];
  var engagementCounters : [Types.EngagementCounter];
  var adminAlerts : [Types.AdminAlert];
  var auditLogs : [Types.AuditLog];
  var feedback : [Types.Feedback];
  var nextId : Nat64;
  var clientPerfSamples : [Types.ClientPerfSample];
  var benchmarks : [Types.Benchmark];
  var sponsorMetrics : [Types.SponsorMetricCounter];
  var sponsorReach : [Types.SponsorReachCounter];
  var adSettings : [Types.AppAdSetting];
  var ads : [Types.AppAd];
  var adEvents : [Types.AdEvent];
  var photoUploads : [Types.PhotoUpload];
  var photoEngagementEvents : [Types.PhotoEngagementEvent];
  var userActivity : [Types.UserActivityEntry];

  transient let MAX_BATCH = 50;
  // list_user_activity is capped at this many rows per call (most-recent-first)
  // to bound message size — callers needing more must narrow since_ms/until_ms.
  transient let MAX_ACTIVITY_LIST = 500;

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

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
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
    let rank = Float.toInt(Float.ceil(p * Int.toFloat(sorted.size()))) - 1;
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
    let total = durations.foldLeft(0.0, func(acc, item) = acc + Int.toFloat(Nat32.toNat(item)));
    #Ok({
      surface; source = switch (source) { case (?s) s; case null "" };
      count = Nat.toNat32(matches.size());
      avg_ms = total / Int.toFloat(matches.size());
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
        let updated = { current with count = current.count + (1 : Nat32); activeUsers };
        engagementCounters := engagementCounters.map(func(item) = if (item.club_id == club_id and item.day == day and item.kind == kind) updated else item);
      };
      case null {
        let activeUsers = switch (byUser) { case (?user) [user]; case null [] };
        engagementCounters := engagementCounters.concat([{ club_id; day; kind; count = (1 : Nat32); activeUsers }]);
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

  // ================= Client perf log =================
  // clientPerfLog equivalent: accepts a batch of per-page/per-metric timing
  // samples from a client flush (mirrors record_perf_samples_batch above but
  // keyed by page path + named metric rather than surface/source, matching
  // the browser's generic clientPerfLog shape). `principal` on each entry
  // lets a single flush cover samples gathered for more than one identity
  // (e.g. a service worker relaying buffered entries); it is trusted as
  // supplied, same as the account-id fields elsewhere in this app pending
  // stronger per-entry attestation.

  public shared ({ caller }) func record_client_perf(entries : [Types.ClientPerfEntry]) : async { #Ok : Nat32; #Err : Text } {
    auth(caller);
    if (entries.size() == 0) return #Err("Empty batch");
    if (entries.size() > MAX_BATCH) return #Err("Batch too large");
    for (item in entries.values()) { if (not valid(item.path) or not valid(item.metric)) return #Err("Invalid client perf entry") };
    let rows = entries.map(func(item : Types.ClientPerfEntry) : Types.ClientPerfSample = { path = item.path; metric = item.metric; value_ms = item.value_ms; at_ms = item.at_ms; user = item.principal });
    clientPerfSamples := clientPerfSamples.concat(rows);
    #Ok(Nat.toNat32(rows.size()))
  };

  // Avg/p50/p95 value_ms for a page path (optionally filtered by metric)
  // over [since_ms, until_ms).
  public query ({ caller }) func client_perf_aggregate(path : Text, metric : ?Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : Types.ClientPerfAggregate; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    let matches = clientPerfSamples.filter(func(item) =
      item.path == path and (metric == null or metric == ?item.metric) and item.at_ms >= since_ms and item.at_ms < until_ms
    );
    if (matches.size() == 0) return #Ok({ path; count = 0; avg_ms = 0.0; p50_ms = 0; p95_ms = 0 });
    let durations = matches.map(func(item) = item.value_ms);
    let sorted = durations.sort(func(a, b) = Nat32.compare(a, b));
    let total = durations.foldLeft(0.0, func(acc, item) = acc + Int.toFloat(Nat32.toNat(item)));
    #Ok({
      path;
      count = Nat.toNat32(matches.size());
      avg_ms = total / Int.toFloat(matches.size());
      p50_ms = percentile(sorted, 0.5);
      p95_ms = percentile(sorted, 0.95);
    })
  };

  // ================= Engagement benchmarks =================
  // Admin-set target/reference values per (metric_key, period), e.g.
  // ("messages_per_active_user", "2026-W40") -> 4.2. Distinct from the
  // computed club_engagement_benchmarks (current vs. previous window) above;
  // these are externally curated reference numbers (industry/org targets).

  // total_members/dau/wau/mau/posters/read_rate are optional engagement-
  // analytics fields layered onto the original metric_key/period/value
  // benchmark row; omit (null) to leave the row's reference-number-only
  // shape unchanged, matching the pre-existing callers.
  public shared ({ caller }) func set_benchmark(
    metric_key : Text,
    period : Text,
    value : Float,
    total_members : ?Nat32,
    dau : ?Nat32,
    wau : ?Nat32,
    mau : ?Nat32,
    posters : ?Nat32,
    read_rate : ?Float,
  ) : async { #Ok; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    if (not valid(metric_key) or not valid(period)) return #Err("Invalid benchmark");
    let updated : Types.Benchmark = { metric_key; period; value; updated_at_ms = nowMs(); total_members; dau; wau; mau; posters; read_rate };
    switch (benchmarks.find(func(item) = item.metric_key == metric_key and item.period == period)) {
      case (?_) { benchmarks := benchmarks.map(func(item) = if (item.metric_key == metric_key and item.period == period) updated else item) };
      case null { benchmarks := benchmarks.concat([updated]) };
    };
    #Ok
  };

  public query ({ caller }) func get_benchmarks(metric_keys : [Text]) : async { #Ok : [Types.Benchmark]; #Err : Text } {
    auth(caller);
    if (metric_keys.size() == 0) return #Ok(benchmarks);
    #Ok(benchmarks.filter(func(item) = metric_keys.any(func(k) = k == item.metric_key)))
  };

  // ================= Sponsor performance rollups =================
  // Free-form per-sponsor metric counters (e.g. "impressions", "clicks",
  // "leads"), bucketed by day like the club engagement counters above so
  // repeated small deltas (one per impression/click event) accumulate
  // cheaply instead of requiring a read-modify-write of a large row set.

  // account_id is optional and only consumed for metric = "unique_reach":
  // when present it is added to that sponsor/day's distinct-reach set
  // instead of accumulating into the plain float counter, so repeat
  // impressions from the same account count once toward unique_reach.
  public shared ({ caller }) func record_sponsor_metric(sponsor_id : Text, metric : Text, delta : Float, account_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(sponsor_id) or not valid(metric)) return #Err("Invalid sponsor metric");
    let period = dayKey(nowMs());
    if (metric == "unique_reach") {
      switch (account_id) {
        case (?account) {
          if (not valid(account)) return #Err("Invalid sponsor metric");
          switch (sponsorReach.find(func(item) = item.sponsor_id == sponsor_id and item.period == period)) {
            case (?current) {
              if (not current.accountIds.any(func(a) = a == account)) {
                let updated = { current with accountIds = current.accountIds.concat([account]) };
                sponsorReach := sponsorReach.map(func(item) = if (item.sponsor_id == sponsor_id and item.period == period) updated else item);
              };
            };
            case null { sponsorReach := sponsorReach.concat([{ sponsor_id; period; accountIds = [account] }]) };
          };
        };
        case null { return #Err("account_id required for unique_reach") };
      };
      return #Ok;
    };
    switch (sponsorMetrics.find(func(item) = item.sponsor_id == sponsor_id and item.metric == metric and item.period == period)) {
      case (?current) {
        let updated = { current with value = current.value + delta };
        sponsorMetrics := sponsorMetrics.map(func(item) = if (item.sponsor_id == sponsor_id and item.metric == metric and item.period == period) updated else item);
      };
      case null { sponsorMetrics := sponsorMetrics.concat([{ sponsor_id; metric; period; value = delta }]) };
    };
    #Ok
  };

  public query ({ caller }) func get_sponsor_performance(sponsor_id : Text, period : Text) : async { #Ok : Types.SponsorPerformance; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    let matches = sponsorMetrics.filter(func(item) = item.sponsor_id == sponsor_id and item.period == period);
    #Ok({ sponsor_id; period; metrics = matches.map(func(item) = { metric = item.metric; value = item.value }) })
  };

  // Per-sponsor performance rows (impressions/clicks summed, distinct
  // unique_reach, derived ctr) over [since_period, until_period] day-key
  // strings (see dayKey), for the engagement analytics UI's sponsor table.
  public query ({ caller }) func get_sponsor_benchmarks(sponsor_ids : [Text], since_period : Text, until_period : Text) : async { #Ok : [Types.SponsorBenchmarkRow]; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    if (sponsor_ids.size() == 0 or sponsor_ids.size() > 100) return #Err("Invalid sponsor list");
    #Ok(sponsor_ids.map(func(sponsor_id : Text) : Types.SponsorBenchmarkRow {
      let metricMatches = sponsorMetrics.filter(func(item) = item.sponsor_id == sponsor_id and item.period >= since_period and item.period <= until_period);
      let impressions = Nat.toNat32(Int.abs(Float.toInt(metricMatches.filter(func(item) = item.metric == "impressions").foldLeft(0.0, func(acc, item) = acc + item.value))));
      let clicks = Nat.toNat32(Int.abs(Float.toInt(metricMatches.filter(func(item) = item.metric == "clicks").foldLeft(0.0, func(acc, item) = acc + item.value))));
      let reachMatches = sponsorReach.filter(func(item) = item.sponsor_id == sponsor_id and item.period >= since_period and item.period <= until_period);
      let reachSet = reachMatches.foldLeft([] : [Text], func(acc, item) = item.accountIds.foldLeft(acc, func(a, id) = if (a.any(func(x) = x == id)) a else a.concat([id])));
      let unique_reach = Nat.toNat32(reachSet.size());
      let ctr = if (impressions == 0) 0.0 else Int.toFloat(Nat32.toNat(clicks)) / Int.toFloat(Nat32.toNat(impressions));
      { sponsor_id; impressions; clicks; unique_reach; ctr }
    }))
  };

  public query ({ caller }) func is_app_admin() : async Bool {
    isAppAdmin(caller)
  };

  // ================= House ads (app_ad_settings / app_ads) =================
  // App-global, operator-managed display config + ad content. Display reads
  // are open (mirroring list_sponsors); writes are app-admin gated.

  public query func get_ad_setting(location : Text) : async ?Types.AppAdSetting {
    adSettings.find(func(s) = s.location == location)
  };

  public query func list_active_ads() : async [Types.AppAd] {
    ads.filter(func(a) = a.is_active).sort(func(a, b) = Nat32.compare(a.display_order, b.display_order))
  };

  public shared ({ caller }) func upsert_ad_setting(location : Text, is_enabled : Bool, override_sponsors : Bool, show_only_when_no_sponsors : Bool) : async { #Ok; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    if (not valid(location)) return #Err("Invalid location");
    let now = nowMs();
    if (adSettings.any(func(s) = s.location == location)) {
      adSettings := adSettings.map(func(s) = if (s.location == location) ({ location; is_enabled; override_sponsors; show_only_when_no_sponsors; updated_at_ms = now }) else s);
    } else {
      adSettings := adSettings.concat([{ location; is_enabled; override_sponsors; show_only_when_no_sponsors; updated_at_ms = now }]);
    };
    #Ok
  };

  public query ({ caller }) func list_ads() : async { #Ok : [Types.AppAd]; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    #Ok(ads.sort(func(a, b) = Nat32.compare(a.display_order, b.display_order)))
  };

  public shared ({ caller }) func create_ad(input : Types.AppAdInput) : async { #Ok : Types.AppAd; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    if (not valid(input.name)) return #Err("Invalid ad name");
    if (input.ad_type != "image" and input.ad_type != "logo_text") return #Err("Invalid ad type");
    let now = nowMs();
    let nextOrder = ads.foldLeft(0 : Nat32, func(acc, a) = if (a.display_order > acc) a.display_order else acc) + 1;
    let ad : Types.AppAd = {
      id = freshId("ad"); name = input.name; ad_type = input.ad_type;
      image_url = input.image_url; logo_url = input.logo_url; link_url = input.link_url;
      description = input.description; headline = input.headline; subtext = input.subtext;
      cta_label = input.cta_label; bg_color = input.bg_color; text_color = input.text_color;
      is_active = true; display_order = nextOrder; created_at_ms = now; updated_at_ms = now;
    };
    ads := ads.concat([ad]);
    #Ok(ad)
  };

  public shared ({ caller }) func update_ad(id : Text, input : Types.AppAdInput) : async { #Ok : Types.AppAd; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    if (not valid(input.name)) return #Err("Invalid ad name");
    if (input.ad_type != "image" and input.ad_type != "logo_text") return #Err("Invalid ad type");
    switch (ads.find(func(a) = a.id == id)) {
      case null #Err("Ad not found");
      case (?existing) {
        let updated : Types.AppAd = { existing with
          name = input.name; ad_type = input.ad_type;
          image_url = input.image_url; logo_url = input.logo_url; link_url = input.link_url;
          description = input.description; headline = input.headline; subtext = input.subtext;
          cta_label = input.cta_label; bg_color = input.bg_color; text_color = input.text_color;
          updated_at_ms = nowMs();
        };
        ads := ads.map(func(a) = if (a.id == id) updated else a);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func set_ad_active(id : Text, is_active : Bool) : async { #Ok; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    if (not ads.any(func(a) = a.id == id)) return #Err("Ad not found");
    ads := ads.map(func(a) = if (a.id == id) ({ a with is_active; updated_at_ms = nowMs() }) else a);
    #Ok
  };

  public shared ({ caller }) func delete_ad(id : Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not isAppAdmin(caller)) return #Err("App admin required");
    if (not ads.any(func(a) = a.id == id)) return #Err("Ad not found");
    ads := ads.filter(func(a) = a.id != id);
    adEvents := adEvents.filter(func(e) = e.ad_id != id);
    #Ok
  };

  // View/click ingest for the ad carousel (app_ad_analytics). Any signed-in
  // member may record; the dedupe/debounce policy stays client-side.
  public shared ({ caller }) func record_ad_event(ad_id : Text, event_type : Text, context : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(ad_id) or not valid(context)) return #Err("Invalid ad event");
    if (event_type != "view" and event_type != "click") return #Err("Invalid event type");
    if (not ads.any(func(a) = a.id == ad_id)) return #Err("Ad not found");
    adEvents := adEvents.concat([{ id = freshId("ade"); ad_id; event_type; context; user = caller; created_at_ms = nowMs() }]);
    #Ok
  };

  // All location settings, for the admin ads settings tab.
  public query ({ caller }) func list_ad_settings() : async { #Ok : [Types.AppAdSetting]; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    #Ok(adSettings.sort(func(a, b) = Text.compare(a.location, b.location)))
  };

  // Per-ad, per-context view/click counts since since_ms, for the admin ads table.
  public query ({ caller }) func ad_event_summary(since_ms : Nat64) : async { #Ok : [Types.AdEventSummary]; #Err : Text } {
    if (not isAppAdmin(caller)) return #Err("App admin required");
    let inRange = adEvents.filter(func(e) = e.created_at_ms >= since_ms);
    var result : [Types.AdEventSummary] = [];
    for (a in ads.values()) {
      let mine = inRange.filter(func(e) = e.ad_id == a.id);
      let contexts = mine.foldLeft([] : [Text], func(acc, e) = if (acc.any(func(c) = c == e.context)) acc else acc.concat([e.context]));
      for (ctx in contexts.values()) {
        let scoped = mine.filter(func(e) = e.context == ctx);
        result := result.concat([{
          ad_id = a.id;
          context = ctx;
          views = Nat.toNat32(scoped.filter(func(e) = e.event_type == "view").size());
          clicks = Nat.toNat32(scoped.filter(func(e) = e.event_type == "click").size());
        }]);
      };
    };
    #Ok(result)
  };
  // ================= Photo counters (upload + engagement) =================
  // Lightweight counters only — media bytes stay in Supabase. Lets the
  // engagement analytics UI show photo upload counts and per-photo
  // view/reaction/comment totals without this canister holding any media.

  public shared ({ caller }) func record_photo_upload(club_id : Text, photo_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(photo_id)) return #Err("Invalid photo upload");
    photoUploads := photoUploads.concat([{ photo_id; club_id; uploaded_at_ms = nowMs() }]);
    #Ok
  };

  public shared ({ caller }) func record_photo_engagement(photo_id : Text, kind : Types.PhotoEngagementKind) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(photo_id)) return #Err("Invalid photo engagement");
    photoEngagementEvents := photoEngagementEvents.concat([{ photo_id; kind; created_at_ms = nowMs() }]);
    #Ok
  };

  // Count of photos uploaded to a club within [since_ms, until_ms).
  public query ({ caller }) func count_photos(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : Nat; #Err : Text } {
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(photoUploads.filter(func(item) = item.club_id == club_id and item.uploaded_at_ms >= since_ms and item.uploaded_at_ms < until_ms).size())
  };

  // Per-photo view/reaction/comment totals for the requested photo ids
  // (bounded to 300 ids per call, matching the prior Supabase chunking).
  public query ({ caller }) func photo_engagement_totals(photo_ids : [Text]) : async { #Ok : [Types.PhotoEngagementTotal]; #Err : Text } {
    auth(caller);
    if (photo_ids.size() == 0) return #Ok([]);
    if (photo_ids.size() > 300) return #Err("Too many photo ids");
    #Ok(photo_ids.map(func(photo_id : Text) : Types.PhotoEngagementTotal {
      let matches = photoEngagementEvents.filter(func(item) = item.photo_id == photo_id);
      {
        photo_id;
        views = matches.filter(func(item) = item.kind == #View).size();
        reactions = matches.filter(func(item) = item.kind == #Reaction).size();
        comments = matches.filter(func(item) = item.kind == #Comment).size();
      }
    }))
  };

  // ================= Per-session user activity log =================
  // Records one page-view/session row (mirrors the former user_activity_logs
  // table). `duration_seconds` is the elapsed time known at record time —
  // callers that track start-then-update locally (as the Supabase RPC pair
  // did) should call this once per page view with the final duration.

  public shared ({ caller }) func record_user_activity(
    user_id : Text,
    club_id : ?Text,
    page_path : Text,
    page_label : Text,
    session_id : Text,
    duration_seconds : Nat32,
  ) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(user_id) or not valid(page_path) or not valid(page_label) or not valid(session_id)) return #Err("Invalid activity entry");
    userActivity := userActivity.concat([{ user_id; club_id; page_path; page_label; session_id; started_at_ms = nowMs(); duration_seconds }]);
    #Ok
  };

  // Admin-gated page-view drill-down over [since_ms, until_ms), optionally
  // scoped to one club. Capped at MAX_ACTIVITY_LIST (500) most-recent rows —
  // callers needing a larger window should narrow since_ms/until_ms rather
  // than paginate, matching this canister's other bounded list queries.
  public query ({ caller }) func list_user_activity(club_id : ?Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : [Types.UserActivityEntry]; #Err : Text } {
    if (not isAppAdmin(caller) and (switch (club_id) { case (?c) not isClubAdmin(caller, c); case null true })) return #Err("Admin required");
    let matches = userActivity.filter(func(item) =
      (club_id == null or club_id == item.club_id) and item.started_at_ms >= since_ms and item.started_at_ms < until_ms
    );
    let sorted = matches.sort(func(a, b) = Nat64.compare(b.started_at_ms, a.started_at_ms));
    let end = Nat.min(MAX_ACTIVITY_LIST, sorted.size());
    #Ok(sorted.sliceToArray(0, end))
  };

  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    if (not isGovernor(caller)) return #err("Forbidden");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #err("Invalid principal");
    if (old.equal(new)) return #err("Old and new principal must differ");
    if (old.equal(governor)) return #err("Cannot rekey the governor");

    let oldText = Principal.toText(old);
    let newText = Principal.toText(new);

    // Conflict guard: count NON-EPHEMERAL records already referencing `new`.
    // Ephemeral/excluded from the guard (rewritten but not counted): webVitals.user,
    // perfSamples.user, clientPerfSamples.user, adEvents.user (telemetry), and
    // userActivity.user_id / engagementCounters.activeUsers / sponsorReach.accountIds
    // (account-id text buckets, not principal-keyed records).
    var conflicts = 0;
    conflicts += roles.filter(func(r) = r.user.equal(new)).size();
    conflicts += adminAlerts.filter(func(a) = a.resolved_by == ?new).size();
    conflicts += auditLogs.filter(func(a) = a.actor_id.equal(new) or a.target_user_id == ?newText).size();
    conflicts += feedback.filter(func(f) = f.user.equal(new)).size();
    if (conflicts > 0) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in insights_domain");

    var changed = 0;

    // roles
    let newRoles = roles.map(func(r : Types.RoleGrant) : Types.RoleGrant {
      if (r.user.equal(old)) { changed += 1; { r with user = new } } else r
    });

    // adminAlerts.resolved_by
    let newAdminAlerts = adminAlerts.map(func(a : Types.AdminAlert) : Types.AdminAlert {
      if (a.resolved_by == ?old) { changed += 1; { a with resolved_by = ?new } } else a
    });

    // auditLogs.actor_id / target_user_id
    let newAuditLogs = auditLogs.map(func(a : Types.AuditLog) : Types.AuditLog {
      var row = a;
      if (row.actor_id.equal(old)) { changed += 1; row := { row with actor_id = new } };
      if (row.target_user_id == ?oldText) { changed += 1; row := { row with target_user_id = ?newText } };
      row
    });

    // feedback.user
    let newFeedback = feedback.map(func(f : Types.Feedback) : Types.Feedback {
      if (f.user.equal(old)) { changed += 1; { f with user = new } } else f
    });

    // ---- Ephemeral: rewritten, not counted in conflict guard ----
    // webVitals.user — on key clash (both old and new rows for same metric/time),
    // keep both since these are append-only telemetry rows, not keyed records.
    let newWebVitals = webVitals.map(func(w : Types.WebVital) : Types.WebVital {
      if (w.user.equal(old)) { { w with user = new } } else w
    });
    let newPerfSamples = perfSamples.map(func(p : Types.PerfSample) : Types.PerfSample {
      if (p.user.equal(old)) { { p with user = new } } else p
    });
    let newClientPerfSamples = clientPerfSamples.map(func(c : Types.ClientPerfSample) : Types.ClientPerfSample {
      if (c.user.equal(old)) { { c with user = new } } else c
    });
    let newAdEvents = adEvents.map(func(e : Types.AdEvent) : Types.AdEvent {
      if (e.user.equal(old)) { { e with user = new } } else e
    });
    let newUserActivity = userActivity.map(func(u : Types.UserActivityEntry) : Types.UserActivityEntry {
      if (u.user_id == oldText) { { u with user_id = newText } } else u
    });
    let newEngagementCounters = engagementCounters.map(func(c : Types.EngagementCounter) : Types.EngagementCounter {
      if (c.activeUsers.any(func(u) = u == oldText)) {
        let withoutOld = c.activeUsers.filter(func(u) = u != oldText);
        let activeUsers = if (withoutOld.any(func(u) = u == newText)) withoutOld else withoutOld.concat([newText]);
        { c with activeUsers }
      } else c
    });
    let newSponsorReach = sponsorReach.map(func(s : Types.SponsorReachCounter) : Types.SponsorReachCounter {
      if (s.accountIds.any(func(a) = a == oldText)) {
        let withoutOld = s.accountIds.filter(func(a) = a != oldText);
        let accountIds = if (withoutOld.any(func(a) = a == newText)) withoutOld else withoutOld.concat([newText]);
        { s with accountIds }
      } else s
    });

    if (not dry_run) {
      roles := newRoles;
      adminAlerts := newAdminAlerts;
      auditLogs := newAuditLogs;
      feedback := newFeedback;
      webVitals := newWebVitals;
      perfSamples := newPerfSamples;
      clientPerfSamples := newClientPerfSamples;
      adEvents := newAdEvents;
      userActivity := newUserActivity;
      engagementCounters := newEngagementCounters;
      sponsorReach := newSponsorReach;
    };

    #ok(changed)
  };

}
