import Principal "mo:core/Principal";
module {
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
    var assets : [Asset];
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
    var galleryChatCards : [GalleryChatCard];
  };
  // Adds the gallery chat card mirror (photo-share prompt cards in team
  // chat) so the II read path can return real data instead of hiding the
  // card. Existing state carries no cards, so this starts empty — Supabase
  // remains the sole writer today; this canister catches up over time.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var assets = old.assets;
      var capabilities = old.capabilities;
      var reactions = old.reactions;
      var comments = old.comments;
      var roles = old.roles;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
      var galleryChatCards = [];
    }
  };
};
