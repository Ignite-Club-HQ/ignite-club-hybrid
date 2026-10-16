// Adds clubDomainCanister wiring for app-admin gated admin endpoints
// (push delivery health, stale device-token cleanup). Follows the partial-
// migration pattern of 20261005 (applied migrations are immutable — see
// backend/AGENTS.md).
import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : { var clubDomainCanister : ?Principal } {
    { var clubDomainCanister = null }
  };
};
