// Adds the downstream canister ids for the permanent-delete fan-out.
// These were first (wrongly) added by editing the already-deployed
// 20261008 migration, which mainnet skipped; this new step introduces
// them properly. Fail-open-by-skip (cleanup skipped while unset) until
// the deploy script wires them.
module {
  public func migration(_ : {}) : {
    var eventsDomainCanister : ?Principal;
    var messagingDomainCanister : ?Principal;
    var piiCanister : ?Principal;
  } {
    {
      var eventsDomainCanister = null;
      var messagingDomainCanister = null;
      var piiCanister = null;
    }
  };
};
