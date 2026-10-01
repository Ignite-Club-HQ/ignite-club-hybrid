import Principal "mo:core/Principal";
module {
  public type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };

  public type WebVital = { id : Text; user : Principal; metric_name : Text; metric_value : Float; rating : Text; page_path : Text; created_at_ms : Nat64 };

  // Generic perf sample covering home/inbox/chat/schedule/realtime/client_perf_log
  // surfaces. `surface` mirrors the originating Supabase table name so
  // aggregate queries can filter/group like the per-surface dashboards did.
  public type PerfSample = { surface : Text; user : Principal; source : Text; duration_ms : Nat32; cache_hit : Bool; platform : Text; created_at_ms : Nat64 };

  public type PerfAggregate = { surface : Text; source : Text; count : Nat32; avg_ms : Float; p50_ms : Nat32; p95_ms : Nat32 };

  public type EngagementEventKind = { #Message; #Rsvp; #ActiveUser; #SponsorImpression; #SponsorClick };
  // One row per (club, day, kind); active-user days additionally record the
  // distinct member text-id set for that bucket.
  public type EngagementCounter = { club_id : Text; day : Text; kind : EngagementEventKind; count : Nat32; activeUsers : [Text] };

  public type EngagementTotals = { club_id : Text; messages : Nat32; rsvps : Nat32; active_users : Nat32; sponsor_impressions : Nat32; sponsor_clicks : Nat32 };
  public type EngagementDayPoint = { day : Text; value : Nat32 };
  public type EngagementBenchmarks = { club_id : Text; current : EngagementTotals; previous : EngagementTotals };

  public type AlertStatus = { #Open; #Resolved };
  public type AdminAlert = { id : Text; alert_type : Text; details : Text; status : AlertStatus; created_at_ms : Nat64; resolved_at_ms : ?Nat64; resolved_by : ?Principal };

  public type AuditLog = { id : Text; action_type : Text; actor_id : Principal; target_user_id : ?Text; target_user_name : ?Text; details : Text; table_name : Text; created_at_ms : Nat64 };

  public type FeedbackStatus = { #Open; #InProgress; #Resolved };
  public type Feedback = { id : Text; user : Principal; kind : Text; title : ?Text; message : Text; page_url : ?Text; status : FeedbackStatus; admin_notes : ?Text; created_at_ms : Nat64; updated_at_ms : Nat64 };

  // ---- Client perf log (clientPerfLog equivalent) ----
  public type ClientPerfEntry = { path : Text; metric : Text; value_ms : Nat32; at_ms : Nat64; principal : Principal };
  public type ClientPerfSample = { path : Text; metric : Text; value_ms : Nat32; at_ms : Nat64; user : Principal };
  public type ClientPerfAggregate = { path : Text; count : Nat32; avg_ms : Float; p50_ms : Nat32; p95_ms : Nat32 };

  // ---- Engagement benchmarks (admin-set target/reference values) ----
  // Optional fields added for the engagement analytics UI (total club
  // membership snapshot, daily/weekly/monthly active users, distinct
  // posters, and read-rate) alongside the original metric_key/period/value
  // reference-number shape; null on rows set before these fields existed.
  public type Benchmark = {
    metric_key : Text;
    period : Text;
    value : Float;
    updated_at_ms : Nat64;
    total_members : ?Nat32;
    dau : ?Nat32;
    wau : ?Nat32;
    mau : ?Nat32;
    posters : ?Nat32;
    read_rate : ?Float;
  };

  // ---- Sponsor performance rollups ----
  public type SponsorMetricCounter = { sponsor_id : Text; metric : Text; period : Text; value : Float };
  public type SponsorPerformance = { sponsor_id : Text; period : Text; metrics : [{ metric : Text; value : Float }] };

  // Per-(sponsor, day) distinct-reach set, mirroring EngagementCounter's
  // activeUsers pattern: record_sponsor_metric appends account_id here when
  // called with metric = "unique_reach" instead of accumulating a plain
  // float delta, so repeated impressions by the same account count once.
  public type SponsorReachCounter = { sponsor_id : Text; period : Text; accountIds : [Text] };

  // Per-sponsor performance row for the engagement analytics UI: summed
  // impressions/clicks over the requested period range, the distinct
  // unique_reach count, and the derived click-through rate (0 when there
  // were no impressions).
  public type SponsorBenchmarkRow = { sponsor_id : Text; impressions : Nat32; clicks : Nat32; unique_reach : Nat32; ctr : Float };

  public type State = {
    var governor : Principal;
    var roles : [RoleGrant];
    var webVitals : [WebVital];
    var perfSamples : [PerfSample];
    var engagementCounters : [EngagementCounter];
    var adminAlerts : [AdminAlert];
    var auditLogs : [AuditLog];
    var feedback : [Feedback];
    var nextId : Nat64;
    var clientPerfSamples : [ClientPerfSample];
    var benchmarks : [Benchmark];
    var sponsorMetrics : [SponsorMetricCounter];
    var sponsorReach : [SponsorReachCounter];
  };
}
