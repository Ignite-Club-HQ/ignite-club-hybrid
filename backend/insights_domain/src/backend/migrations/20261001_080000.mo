import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  type WebVital = { id : Text; user : Principal; metric_name : Text; metric_value : Float; rating : Text; page_path : Text; created_at_ms : Nat64 };
  type PerfSample = { surface : Text; user : Principal; source : Text; duration_ms : Nat32; cache_hit : Bool; platform : Text; created_at_ms : Nat64 };
  type EngagementEventKind = { #Message; #Rsvp; #ActiveUser; #SponsorImpression; #SponsorClick };
  type EngagementCounter = { club_id : Text; day : Text; kind : EngagementEventKind; count : Nat32; activeUsers : [Text] };
  type AlertStatus = { #Open; #Resolved };
  type AdminAlert = { id : Text; alert_type : Text; details : Text; status : AlertStatus; created_at_ms : Nat64; resolved_at_ms : ?Nat64; resolved_by : ?Principal };
  type AuditLog = { id : Text; action_type : Text; actor_id : Principal; target_user_id : ?Text; target_user_name : ?Text; details : Text; table_name : Text; created_at_ms : Nat64 };
  type FeedbackStatus = { #Open; #InProgress; #Resolved };
  type Feedback = { id : Text; user : Principal; kind : Text; title : ?Text; message : Text; page_url : ?Text; status : FeedbackStatus; admin_notes : ?Text; created_at_ms : Nat64; updated_at_ms : Nat64 };
  type ClientPerfSample = { path : Text; metric : Text; value_ms : Nat32; at_ms : Nat64; user : Principal };

  type OldBenchmark = { metric_key : Text; period : Text; value : Float; updated_at_ms : Nat64 };
  type NewBenchmark = {
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
  type SponsorMetricCounter = { sponsor_id : Text; metric : Text; period : Text; value : Float };
  type SponsorReachCounter = { sponsor_id : Text; period : Text; accountIds : [Text] };

  type OldActor = {
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
    var benchmarks : [OldBenchmark];
    var sponsorMetrics : [SponsorMetricCounter];
  };
  type NewActor = {
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
    var benchmarks : [NewBenchmark];
    var sponsorMetrics : [SponsorMetricCounter];
    var sponsorReach : [SponsorReachCounter];
  };

  // Adds optional engagement-analytics fields (total_members/dau/wau/mau/
  // posters/read_rate) to each existing Benchmark row, defaulted to null
  // since those weren't previously captured; adds the new per-sponsor
  // distinct-reach store (sponsorReach), starting empty.
  public func migration(old : OldActor) : NewActor {
    {
      old with
      benchmarks = old.benchmarks.map<NewBenchmark>(func(b) {
        { b with total_members = null; dau = null; wau = null; mau = null; posters = null; read_rate = null }
      });
      sponsorReach = [];
    }
  };
};
