module {
  type OldActor = {};
  type NewActor = {
    var eventsDomainCanister : ?Principal;
    var vaultDomainCanister : ?Principal;
    var piiAccessControlCanister : ?Principal;
  };

  public func migration(_ : OldActor) : NewActor {
    { var eventsDomainCanister = null; var vaultDomainCanister = null; var piiAccessControlCanister = null }
  };
};