import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type BlobRef = { canister : Text; path : Text; content_hash : Text };
  type OldFolder = {
    id : Text; club : Text; team : ?Text; parent_id : ?Text; name : Text;
    restricted_roles : [Text]; created_by : Principal; created_at_ms : Nat64; deleted_at_ms : ?Nat64;
    deleted_by : ?Principal; mini_league_id : ?Text;
  };
  type Folder = {
    id : Text; club : Text; team : ?Text; parent_id : ?Text; name : Text;
    restricted_roles : [Text]; created_by : Principal; created_at_ms : Nat64; deleted_at_ms : ?Nat64;
    deleted_by : ?Principal; mini_league_id : ?Text;
    sort_order : Nat32; description : ?Text; color : ?Text;
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
    var files : [File];
    var roles : [RoleGrant];
  };
  type NewActor = {
    var governor : Principal;
    var folders : [Folder];
    var files : [File];
    var roles : [RoleGrant];
  };
  // Adds the team_folders display metadata (sort_order, description, color).
  // Existing folders default to sort order 0 and no description/color, which
  // matches how the Supabase-backed UI renders folders without those columns.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var folders = Array.map<OldFolder, Folder>(old.folders, func(f) {
        { id = f.id; club = f.club; team = f.team; parent_id = f.parent_id; name = f.name;
          restricted_roles = f.restricted_roles; created_by = f.created_by; created_at_ms = f.created_at_ms;
          deleted_at_ms = f.deleted_at_ms; deleted_by = f.deleted_by; mini_league_id = f.mini_league_id;
          sort_order = 0; description = null; color = null }
      });
      var files = old.files;
      var roles = old.roles;
    }
  };
};
