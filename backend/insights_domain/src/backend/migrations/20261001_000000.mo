import Types "../../types";
module {
  type OldActor = {
    var governor : Principal;
    var roles : [Types.RoleGrant];
    var webVitals : [Types.WebVital];
    var perfSamples : [Types.PerfSample];
    var engagementCounters : [Types.EngagementCounter];
    var adminAlerts : [Types.AdminAlert];
    var auditLogs : [Types.AuditLog];
    var feedback : [Types.Feedback];
    var nextId : Nat64;
  };
  type NewActor = {
    var governor : Principal;
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
  };
  // Adds client perf log, engagement benchmarks, and sponsor performance
  // rollup state; all start empty, no backfill needed for new state.
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
      var clientPerfSamples = [];
      var benchmarks = [];
      var sponsorMetrics = [];
    }
  };
};
