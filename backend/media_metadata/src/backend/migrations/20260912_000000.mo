import Principal "mo:core/Principal";
module {
  type Asset = {
    id : Text;
    club_id : Text;
    owner : Principal;
    kind : Text;
    mime : Text;
    checksum : Text;
    storage_path : Text;
    visibility : Text;
    content_length : Nat64;
    encrypted : Bool;
    child_sensitive : Bool;
    retention_until_ms : Nat64;
    deleted : Bool;
    expires_at_ms : Nat64;
  };
  type Capability = {
    asset_id : Text;
    action : Text;
    owner : Principal;
    allowed : Bool;
    purpose : Text;
    expires_at_ms : Nat64;
  };
  type OldActor = {};
  type NewActor = {
    var governor : Principal;
    var assets : [Asset];
    var capabilities : [Capability];
  };
  public func migration(_old : OldActor) : NewActor {
    { var governor = Principal.anonymous(); var assets = []; var capabilities = [] }
  };
};