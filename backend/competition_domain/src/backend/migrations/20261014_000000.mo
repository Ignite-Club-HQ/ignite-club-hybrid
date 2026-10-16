module {
  type OldActor = {};
  type NewActor = {
    var eventsDomainCanister : ?Principal;
    var vaultDomainCanister : ?Principal;
    var piiAccessControlCanister : ?Principal;
    var competitionOfficialEmailInvites : [{ competition_id : Text; token : Text; role : Text; email_hash : Text; verification_code_hash : Text; created_by : Principal; created_at_ms : Nat64; expires_at_ms : Nat64; attempts : Nat8; accepted_by : ?Principal; revoked : Bool }];
  };

  public func migration(_ : OldActor) : NewActor {
    { var eventsDomainCanister = null; var vaultDomainCanister = null; var piiAccessControlCanister = null; var competitionOfficialEmailInvites = [] }
  };
};