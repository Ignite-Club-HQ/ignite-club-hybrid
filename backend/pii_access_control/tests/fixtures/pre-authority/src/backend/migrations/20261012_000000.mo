module {
  type NewActor = {
    var competition_read_grants : [{ pii_id : Text; field_id : Text; competition_id : Text }];
    var competition_domain_canister : ?Principal;
  };

  public func migration(_ : {}) : NewActor {
    { var competition_read_grants = []; var competition_domain_canister = null }
  };
};