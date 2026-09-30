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

  public type AuditLog = { id : Text; action_type : Text; actor : Principal; target_user_id : ?Text; target_user_name : ?Text; details : Text; table_name : Text; created_at_ms : Nat64 };

  public type FeedbackStatus = { #Open; #InProgress; #Resolved };
  public type Feedback = { id : Text; user : Principal; kind : Text; title : ?Text; message : Text; page_url : ?Text; status : FeedbackStatus; admin_notes : ?Text; created_at_ms : Nat64; updated_at_ms : Nat64 };

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
  };
}
