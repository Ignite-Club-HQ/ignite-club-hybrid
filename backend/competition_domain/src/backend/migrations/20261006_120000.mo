module {
  type DivisionSetting = { competition_id : Text; division : Text; hide_ladder : Bool };
  type Broadcast = { id : Text; competition_id : Text; sender : Principal; title : Text; body : Text; created_at_ms : Nat64 };
  // Adds per-division ladder visibility, competition broadcasts and the
  // club_domain wiring used to mirror live club-admin roles.
  public func migration(_ : {}) : {
    var divisionSettings : [DivisionSetting];
    var broadcasts : [Broadcast];
    var clubDomainCanister : ?Principal;
  } {
    { var divisionSettings = []; var broadcasts = []; var clubDomainCanister = null }
  };
};
