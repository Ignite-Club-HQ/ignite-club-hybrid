module {
  public type Asset = {
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
  public type Capability = {
    asset_id : Text;
    action : Text;
    owner : Principal;
    allowed : Bool;
    purpose : Text;
    expires_at_ms : Nat64;
  };
  public type Reaction = {
    asset_id : Text;
    user : Principal;
    kind : Text;
    created_at_ms : Nat64;
  };
  public type Comment = {
    id : Text;
    asset_id : Text;
    author : Principal;
    body : Text;
    created_at_ms : Nat64;
    deleted : Bool;
  };
  public type RoleGrant = {
    user : Principal;
    role : Text;
    club_id : ?Text;
    team_id : ?Text;
  };
  public type State = {
    schema : Nat32;
    governor : Principal;
    assets : [Asset];
    capabilities : [Capability];
    reactions : [Reaction];
    comments : [Comment];
    roles : [RoleGrant];
  };
}