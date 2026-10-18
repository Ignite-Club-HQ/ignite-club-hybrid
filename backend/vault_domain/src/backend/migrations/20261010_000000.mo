import Principal "mo:core/Principal";

module {
  // Adds the on-chain vault backups map (governor/app-admin only — see
  // create_backup/list_backups/get_backup/restore_backup/delete_backup in
  // main.mo) and the counter used to mint backup ids.
  //
  // Types are frozen to the exact shape mainnet stored when this migration
  // ran (before competition_id existed). It originally referenced the live
  // Types module, which silently changed its output type and broke the
  // upgrade chain; 20261012_100000 converts the stored backups forward.
  type BlobRef = { canister : Text; path : Text; content_hash : Text };
  type Folder = {
    id : Text; club : Text; team : ?Text; parent_id : ?Text; name : Text;
    restricted_roles : [Text]; created_by : Principal; created_at_ms : Nat64;
    deleted_at_ms : ?Nat64; deleted_by : ?Principal; mini_league_id : ?Text;
    sort_order : Nat32; description : ?Text; color : ?Text;
  };
  type File = {
    id : Text; folder_id : Text; club : Text; team : ?Text; name : Text;
    file_url : Text; size : Nat64; mime : Text; uploaded_by : Principal;
    created_at_ms : Nat64; deleted_at_ms : ?Nat64; deleted_by : ?Principal;
    mini_league_id : ?Text; is_external_link : Bool; blob_ref : ?BlobRef;
  };
  type Backup = {
    id : Text; backup_label : Text; created_at_ms : Nat64; created_by : Principal;
    folders : [Folder]; files : [File];
  };

  public func migration(_ : {}) : { var backups : [Backup]; var nextBackupSeq : Nat64 } {
    { var backups = []; var nextBackupSeq = 0 }
  };
};
