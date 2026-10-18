// Converts stored vault backups to the competition-aware file/folder shape.
// 20261012_000000 added competition_id to live folders/files but left the
// snapshots inside `backups` in the old shape, so mainnet (which applied
// 20261010 with the old VaultFile/VaultFolder) rejected the upgrade as
// memory-incompatible. Types are frozen inline on purpose — never reference
// the live Types module from a migration.
import Array "mo:core/Array";
import Principal "mo:core/Principal";

module {
  type BlobRef = { canister : Text; path : Text; content_hash : Text };
  type OldFolder = {
    id : Text; club : Text; team : ?Text; parent_id : ?Text; name : Text;
    restricted_roles : [Text]; created_by : Principal; created_at_ms : Nat64;
    deleted_at_ms : ?Nat64; deleted_by : ?Principal; mini_league_id : ?Text;
    sort_order : Nat32; description : ?Text; color : ?Text;
  };
  type Folder = {
    id : Text; club : Text; team : ?Text; parent_id : ?Text; name : Text;
    restricted_roles : [Text]; created_by : Principal; created_at_ms : Nat64;
    deleted_at_ms : ?Nat64; deleted_by : ?Principal; mini_league_id : ?Text;
    competition_id : ?Text; sort_order : Nat32; description : ?Text; color : ?Text;
  };
  type OldFile = {
    id : Text; folder_id : Text; club : Text; team : ?Text; name : Text;
    file_url : Text; size : Nat64; mime : Text; uploaded_by : Principal;
    created_at_ms : Nat64; deleted_at_ms : ?Nat64; deleted_by : ?Principal;
    mini_league_id : ?Text; is_external_link : Bool; blob_ref : ?BlobRef;
  };
  type File = {
    id : Text; folder_id : Text; club : Text; team : ?Text; name : Text;
    file_url : Text; size : Nat64; mime : Text; uploaded_by : Principal;
    created_at_ms : Nat64; deleted_at_ms : ?Nat64; deleted_by : ?Principal;
    mini_league_id : ?Text; competition_id : ?Text;
    is_external_link : Bool; blob_ref : ?BlobRef;
  };
  type OldBackup = {
    id : Text; backup_label : Text; created_at_ms : Nat64; created_by : Principal;
    folders : [OldFolder]; files : [OldFile];
  };
  type Backup = {
    id : Text; backup_label : Text; created_at_ms : Nat64; created_by : Principal;
    folders : [Folder]; files : [File];
  };

  public func migration(old : { var backups : [OldBackup] }) : { var backups : [Backup] } {
    {
      var backups = Array.map<OldBackup, Backup>(old.backups, func(b) {
        {
          id = b.id; backup_label = b.backup_label;
          created_at_ms = b.created_at_ms; created_by = b.created_by;
          folders = Array.map<OldFolder, Folder>(b.folders, func(f) { { f with competition_id = null } });
          files = Array.map<OldFile, File>(b.files, func(f) { { f with competition_id = null } });
        }
      });
    }
  };
};
