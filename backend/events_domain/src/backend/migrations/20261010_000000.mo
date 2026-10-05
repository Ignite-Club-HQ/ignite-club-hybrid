// Adds clubDomainCanister (first wrongly added by editing the
// already-deployed 20261009 migration). Fail-closed until the deploy
// script wires club_domain.
module {
  public func migration(_ : {}) : { var clubDomainCanister : ?Principal } {
    { var clubDomainCanister = null }
  };
};
