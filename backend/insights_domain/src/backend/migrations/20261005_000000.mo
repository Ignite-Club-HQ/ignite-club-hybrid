import Array "mo:core/Array";
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
  type Benchmark = {
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

  // House ads (Supabase app_ad_settings / app_ads / app_ad_analytics).
  type AppAdSetting = { location : Text; is_enabled : Bool; override_sponsors : Bool; show_only_when_no_sponsors : Bool; updated_at_ms : Nat64 };
  type AppAd = {
    id : Text; name : Text; ad_type : Text; image_url : ?Text; logo_url : ?Text;
    link_url : ?Text; description : ?Text; headline : ?Text; subtext : ?Text;
    cta_label : ?Text; bg_color : ?Text; text_color : ?Text;
    is_active : Bool; display_order : Nat32; created_at_ms : Nat64; updated_at_ms : Nat64;
  };
  type AdEvent = { id : Text; ad_id : Text; event_type : Text; context : Text; user : Principal; created_at_ms : Nat64 };

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
    var benchmarks : [Benchmark];
    var sponsorMetrics : [SponsorMetricCounter];
    var sponsorReach : [SponsorReachCounter];
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
    var benchmarks : [Benchmark];
    var sponsorMetrics : [SponsorMetricCounter];
    var sponsorReach : [SponsorReachCounter];
    var adSettings : [AppAdSetting];
    var ads : [AppAd];
    var adEvents : [AdEvent];
  };

  // Adds the house-ad stores (per-location display settings, ad records, and
  // view/click events), all starting empty. Data-preserving: every existing
  // field is carried through unchanged.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var webVitals = old.webVitals;
      var perfSamples = old.perfSamples;
      var engagementCounters = old.engagementCounters;
      var adminAlerts = old.adminAlerts;
      var auditLogs = old.auditLogs;
      var feedback = old.feedback;
      var nextId = old.nextId;
      var clientPerfSamples = old.clientPerfSamples;
      var benchmarks = old.benchmarks;
      var sponsorMetrics = old.sponsorMetrics;
      var sponsorReach = old.sponsorReach;
      var adSettings = [];
      var ads = [];
      var adEvents = [];
    }
  };
};
