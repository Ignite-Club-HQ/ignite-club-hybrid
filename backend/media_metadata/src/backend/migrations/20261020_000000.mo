import Principal "mo:core/Principal";
module {
  type BlobRef = {
    canister : Text;
    path : Text;
    content_hash : Text;
  };
  type OldAsset = {
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
    created_at_ms : Nat64;
    team_id : ?Text;
    mini_league_id : ?Text;
    competition_id : ?Text;
    event_id : ?Text;
    caption : ?Text;
    album_id : ?Text;
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
  type GalleryChatCard = {
    id : Text;
    club_id : Text;
    team_id : Text;
    event_id : ?Text;
    message_id : Text;
    hero_photo_id : ?Text;
    hero_image_url : ?Text;
    photo_count : Nat32;
    photo_ids : [Text];
    is_prompt : Bool;
    push_sent : Bool;
    uploader_id : Principal;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };
  type OldActor = {
    var governor : Principal;
    var assets : [OldAsset];
    var capabilities : [Capability];
    var reactions : [Reaction];
    var comments : [Comment];
    var roles : [RoleGrant];
    var bulkAccessPrincipals : [Principal];
    var galleryChatCards : [GalleryChatCard];
  };
  type NewActor = {
    var governor : Principal;
    var assets : [Asset];
    var capabilities : [Capability];
    var reactions : [Reaction];
    var comments : [Comment];
    var roles : [RoleGrant];
    var bulkAccessPrincipals : [Principal];
    var galleryChatCards : [GalleryChatCard];
  };
  // Adds scope fields (team / mini-league / competition / event / caption /
  // album) and created_at_ms to assets so the ICP media feed can tag and
  // group photos like the Supabase gallery. Existing assets get null scopes
  // and their expiry timestamp as the created timestamp (closest known
  // value); they can be re-tagged later via set_asset_scope.
  public func migration(old : OldActor) : NewActor {
    let newAssets = Array.tabulate<Asset>(
      old.assets.size(),
      func(i) {
        let a = old.assets[i];
        {
          id = a.id;
          club_id = a.club_id;
          owner = a.owner;
          kind = a.kind;
          mime = a.mime;
          checksum = a.checksum;
          storage_path = a.storage_path;
          blob_ref = a.blob_ref;
          visibility = a.visibility;
          content_length = a.content_length;
          encrypted = a.encrypted;
          child_sensitive = a.child_sensitive;
          retention_until_ms = a.retention_until_ms;
          deleted = a.deleted;
          expires_at_ms = a.expires_at_ms;
          created_at_ms = a.expires_at_ms;
          team_id = null;
          mini_league_id = null;
          competition_id = null;
          event_id = null;
          caption = null;
          album_id = null;
        };
      },
    );
    {
      var governor = old.governor;
      var assets = newAssets;
      var capabilities = old.capabilities;
      var reactions = old.reactions;
      var comments = old.comments;
      var roles = old.roles;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
      var galleryChatCards = old.galleryChatCards;
    };
  };
};
