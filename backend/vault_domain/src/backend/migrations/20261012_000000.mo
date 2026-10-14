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
  type OldActor = { var folders : [OldFolder]; var files : [OldFile] };
  type NewActor = {
    var competition_domain_canister : ?Principal;
    var folders : [Folder];
    var files : [File];
  };

  public func migration(old : OldActor) : NewActor {
    {
      var competition_domain_canister = null;
      var folders = Array.map<OldFolder, Folder>(old.folders, func(folder) {
        {
          id = folder.id; club = folder.club; team = folder.team;
          parent_id = folder.parent_id; name = folder.name;
          restricted_roles = folder.restricted_roles; created_by = folder.created_by;
          created_at_ms = folder.created_at_ms; deleted_at_ms = folder.deleted_at_ms;
          deleted_by = folder.deleted_by; mini_league_id = folder.mini_league_id;
          competition_id = null; sort_order = folder.sort_order;
          description = folder.description; color = folder.color;
        }
      });
      var files = Array.map<OldFile, File>(old.files, func(file) {
        {
          id = file.id; folder_id = file.folder_id; club = file.club; team = file.team;
          name = file.name; file_url = file.file_url; size = file.size; mime = file.mime;
          uploaded_by = file.uploaded_by; created_at_ms = file.created_at_ms;
          deleted_at_ms = file.deleted_at_ms; deleted_by = file.deleted_by;
          mini_league_id = file.mini_league_id; competition_id = null;
          is_external_link = file.is_external_link; blob_ref = file.blob_ref;
        }
      });
    }
  };
};