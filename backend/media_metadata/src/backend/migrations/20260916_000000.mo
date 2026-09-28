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
  type Reaction = {
    asset_id : Text;
    user : Principal;
    kind : Text;
    created_at_ms : Nat64;
  };
  type Comment = {
    id : Text;
    asset_id : Text;
    author : Principal;
    body : Text;
    created_at_ms : Nat64;
    deleted : Bool;
  };
  type RoleGrant = {
    user : Principal;
    role : Text;
    club_id : ?Text;
    team_id : ?Text;
  };
  type OldActor = {
    var governor : Principal;
    var assets : [Asset];
    var capabilities : [Capability];
  };
  type NewActor = {
    var governor : Principal;
    var assets : [Asset];
    var capabilities : [Capability];
    var reactions : [Reaction];
    var comments : [Comment];
    var roles : [RoleGrant];
  };
  // Adds reactions/comments/role-grants for the club media feed while
  // preserving every asset and capability already committed.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var assets = old.assets;
      var capabilities = old.capabilities;
      var reactions = [];
      var comments = [];
      var roles = [];
    }
  };
};
