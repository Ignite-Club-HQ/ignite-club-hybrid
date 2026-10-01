import Types "../../types";
module {
  // Frozen shape of Benchmark as of this migration. Do NOT change this to
  // Types.Benchmark — that type evolved later (optional analytics fields)
  // and this file's NewActor is part of the recorded chain history.
  type BenchmarkV1 = { metric_key : Text; period : Text; value : Float; updated_at_ms : Nat64 };
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
    var benchmarks : [BenchmarkV1];
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
