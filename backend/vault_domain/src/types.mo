module {
  // Vault file and folder metadata. File bytes live outside this canister
  // (Supabase storage today, the media_blob_store canister later — see
  // blob_ref); this canister owns the folder tree, scoping, and soft delete.
  public type BlobRef = {
    canister : Text;
    path : Text;
    content_hash : Text;
  };

  public type VaultFolder = {
    id : Text;
    club : Text;
    team : ?Text;
    parent_id : ?Text;
    name : Text;
    restricted_roles : [Text];
    created_by : Principal;
    created_at_ms : Nat64;
    deleted_at_ms : ?Nat64;
    deleted_by : ?Principal;
    mini_league_id : ?Text;
  };

  public type VaultFile = {
    id : Text;
    folder_id : Text;
    club : Text;
    team : ?Text;
    name : Text;
    file_url : Text;
    size : Nat64;
    mime : Text;
    uploaded_by : Principal;
    created_at_ms : Nat64;
    deleted_at_ms : ?Nat64;
    deleted_by : ?Principal;
    mini_league_id : ?Text;
    is_external_link : Bool;
    blob_ref : ?BlobRef;
  };

  // Folder path/name join for the vault browser (breadcrumb of ancestor
  // folder names, root first). Empty path/null name means no live folder
  // (vault root or a deleted folder).
  public type VaultFileWithFolder = {
    file : VaultFile;
    folder_name : ?Text;
    folder_path : [Text];
  };

  public type RoleGrant = {
    user : Principal;
    role : Text;
    club_id : ?Text;
    team_id : ?Text;
  };
};