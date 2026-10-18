// Adds competitionDomainCanister. main.mo declared it without any migration
// introducing it, so mainnet rejected the upgrade (the previous version has no
// such variable). Unset until the deploy script wires it (fail-closed).
import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : { var competitionDomainCanister : ?Principal } {
    { var competitionDomainCanister = null }
  };
};
