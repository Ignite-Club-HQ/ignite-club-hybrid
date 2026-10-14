module {
  type OldActor = {};
  type NewActor = { var clubDomainCanister : ?Principal };

  public func migration(_ : OldActor) : NewActor {
    { var clubDomainCanister = null }
  };
};