import Principal "mo:core/Principal";
import Types "../../types";
module {
  type OldActor = {};
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
  };
  // Bootstrap: seeds an empty state; the canister has no external initializer.
  public func migration(_old : OldActor) : NewActor {
    { var governor = Principal.anonymous(); var roles = []; var webVitals = []; var perfSamples = []; var engagementCounters = []; var adminAlerts = []; var auditLogs = []; var feedback = []; var nextId = 0 }
  };
};
