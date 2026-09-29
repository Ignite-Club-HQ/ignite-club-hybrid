import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type BlobRef = { canister : Text; path : Text; content_hash : Text };
  type OldFolder = {
    id : Text; club : Text; team : ?Text; parent_id : ?Text; name : Text;
    restricted_roles : [Text]; created_by : Principal; created_at_ms : Nat64; deleted_at_ms : ?Nat64;
  };
  type Folder = {
    id : Text; club : Text; team : ?Text; parent_id : ?Text; name : Text;
    restricted_roles : [Text]; created_by : Principal; created_at_ms : Nat64; deleted_at_ms : ?Nat64;
    deleted_by : ?Principal; mini_league_id : ?Text;
  };
  type OldFile = {
    id : Text; folder_id : Text; club : Text; team : ?Text; name : Text;
    file_url : Text; size : Nat64; mime : Text; uploaded_by : Principal;
    created_at_ms : Nat64; deleted_at_ms : ?Nat64; is_external_link : Bool; blob_ref : ?BlobRef;
  };
  type File = {
    id : Text; folder_id : Text; club : Text; team : ?Text; name : Text;
    file_url : Text; size : Nat64; mime : Text; uploaded_by : Principal;
    created_at_ms : Nat64; deleted_at_ms : ?Nat64; deleted_by : ?Principal; mini_league_id : ?Text;
    is_external_link : Bool; blob_ref : ?BlobRef;
  };
  type RoleGrant = { user : Principal; role : Text; club_id : ?Text; team_id : ?Text };
  type OldActor = {
    var governor : Principal;
    var folders : [OldFolder];
    var files : [OldFile];
    var roles : [RoleGrant];
  };
  type NewActor = {
    var governor : Principal;
    var folders : [Folder];
    var files : [File];
    var roles : [RoleGrant];
  };
  // Adds the trash actor (deleted_by) and mini-league scoping. Existing rows
  // gain null actor and null mini-league — the trash view shows them without
  // an actor, matching the provisional Supabase mapping.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var folders = Array.map<OldFolder, Folder>(old.folders, func(f) {
        { id = f.id; club = f.club; team = f.team; parent_id = f.parent_id; name = f.name;
          restricted_roles = f.restricted_roles; created_by = f.created_by; created_at_ms = f.created_at_ms;
          deleted_at_ms = f.deleted_at_ms; deleted_by = null; mini_league_id = null }
      });
      var files = Array.map<OldFile, File>(old.files, func(f) {
        { id = f.id; folder_id = f.folder_id; club = f.club; team = f.team; name = f.name;
          file_url = f.file_url; size = f.size; mime = f.mime; uploaded_by = f.uploaded_by;
          created_at_ms = f.created_at_ms; deleted_at_ms = f.deleted_at_ms; deleted_by = null; mini_league_id = null;
          is_external_link = f.is_external_link; blob_ref = f.blob_ref }
      });
      var roles = old.roles;
    }
  };
};