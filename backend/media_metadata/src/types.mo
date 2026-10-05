module {
  // Optional pointer to bytes held by an ICP blob-store canister
  // (canister key "media_blob_store"). When absent, the asset's bytes live
  // in off-chain object storage addressed by storage_path.
  public type BlobRef = {
    canister : Text;
    path : Text;
    content_hash : Text;
  };
  public type Asset = {
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
    // Feed scoping/tags (schema 4): which audience the asset belongs to and
    // how posts group. All optional so pre-schema-4 assets decode with null
    // (club-wide, uncaptioned, single-photo post). created_at_ms is 0 for
    // pre-schema-4 assets; feed ordering treats 0 as "unknown, sort last".
    created_at_ms : Nat64;
    team_id : ?Text;
    mini_league_id : ?Text;
    competition_id : ?Text;
    event_id : ?Text;
    caption : ?Text;
    album_id : ?Text;
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
  // Mirrors the Supabase gallery_chat_cards row shape (photo-share prompt
  // cards surfaced in team chat). Supabase remains the writer for now — the
  // row is created by a DB trigger/edge function outside the frontend — this
  // canister exists so the II read path has real data instead of hiding the
  // card. club_id is NOT a Supabase column; it is added here because this
  // canister's authorization model (club membership/staff) is club-scoped
  // and the Supabase row only carries team_id.
  public type GalleryChatCard = {
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
  public type State = {
    schema : Nat32;
    governor : Principal;
    assets : [Asset];
    capabilities : [Capability];
    reactions : [Reaction];
    comments : [Comment];
    roles : [RoleGrant];
    galleryChatCards : [GalleryChatCard];
  };
}
