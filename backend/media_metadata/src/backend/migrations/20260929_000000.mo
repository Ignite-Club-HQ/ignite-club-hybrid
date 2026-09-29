import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type OldAsset = {
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
  type BlobRef = {
    canister : Text;
    path : Text;
    content_hash : Text;
  };
  type Asset = {
    id : Text;
    club_id : Text;
    owner : Principal;
    kind : Text;
    mime : Text;
    checksum : Text;
    storage_path : Text;
    blob_ref : ?BlobRef;
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
    var assets : [OldAsset];
    var capabilities : [Capability];
    var reactions : [Reaction];
    var comments : [Comment];
    var roles : [RoleGrant];
    var bulkAccessPrincipals : [Principal];
  };
  type NewActor = {
    var governor : Principal;
    var assets : [Asset];
    var capabilities : [Capability];
    var reactions : [Reaction];
    var comments : [Comment];
    var roles : [RoleGrant];
    var bulkAccessPrincipals : [Principal];
  };
  // Adds an optional on-chain blob pointer (blob_ref) to every asset.
  // Existing assets keep their off-chain storage_path with blob_ref = null,
  // so resolution falls back to object storage until a blob store exists.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var assets = Array.map<OldAsset, Asset>(old.assets, func(a) {
        {
          id = a.id;
          club_id = a.club_id;
          owner = a.owner;
          kind = a.kind;
          mime = a.mime;
          checksum = a.checksum;
          storage_path = a.storage_path;
          blob_ref = null;
          visibility = a.visibility;
          content_length = a.content_length;
          encrypted = a.encrypted;
          child_sensitive = a.child_sensitive;
          retention_until_ms = a.retention_until_ms;
          deleted = a.deleted;
          expires_at_ms = a.expires_at_ms;
        }
      });
      var capabilities = old.capabilities;
      var reactions = old.reactions;
      var comments = old.comments;
      var roles = old.roles;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
    }
  };
};
