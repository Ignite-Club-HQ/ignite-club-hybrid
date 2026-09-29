import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "types";

persistent actor {
  var governor : Principal;
  var folders : [Types.VaultFolder];
  var files : [Types.VaultFile];
  var roles : [Types.RoleGrant];

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
    #Ok
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required");
  };

  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };

  func validLong(value : Text, max : Nat) : Bool { value != "" and value.size() <= max };

  func validRoles(list : [Text]) : Bool {
    list.size() <= 16 and list.all(func(role) = valid(role))
  };

  func validBlobRef(ref : Types.BlobRef) : Bool {
    valid(ref.canister) and validLong(ref.path, 512) and validLong(ref.content_hash, 128)
  };

  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func hasRole(caller : Principal, club : Text, team : ?Text) : Bool {
    roles.any(func(grant) =
      grant.user.equal(caller) and
      grant.club_id == ?club and
      (team == null or grant.team_id == team or grant.team_id == null))
  };

  // NOTE: access control is club-scoped via role grants assigned by the
  // governor. Like the other domain canisters, the browser-supplied club and
  // team ids are trusted text until account ids are bound to principals via
  // identity_access — see roadmap.

  // A folder with restricted_roles is visible only to the governor or a
  // caller holding one of the listed roles within the folder's club/team
  // scope. Empty restricted_roles means visible to any club member.
  func canViewFolder(caller : Principal, folder : Types.VaultFolder) : Bool {
    if (folder.restricted_roles.size() == 0 or isGovernor(caller)) return true;
    roles.any(func(grant) =
      grant.user.equal(caller) and
      grant.club_id == ?folder.club and
      (folder.team == null or grant.team_id == folder.team or grant.team_id == null) and
      folder.restricted_roles.any(func(role) = role == grant.role))
  };

  public shared ({ caller }) func grant_role(user : Principal, role : Text, club_id : ?Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not valid(role)) return #Err("Invalid role");
    roles := roles.concat([{ user; role; club_id; team_id }]);
    #Ok
  };

  public shared ({ caller }) func create_folder(
    id : Text,
    club : Text,
    team : ?Text,
    parent_id : ?Text,
    name : Text,
    restricted_roles : [Text],
    mini_league_id : ?Text,
  ) : async { #Ok : Types.VaultFolder; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, club, team)) return #Err("Club role required");
    if (not valid(id) or not valid(club) or not validLong(name, 160)) return #Err("Invalid folder fields");
    if (not validRoles(restricted_roles)) return #Err("Invalid restricted roles");
    switch (team) { case (?t) { if (not valid(t)) return #Err("Invalid team") }; case null {} };
    switch (mini_league_id) { case (?m) { if (not valid(m)) return #Err("Invalid mini league") }; case null {} };
    switch (parent_id) {
      case (?parent) {
        if (not valid(parent)) return #Err("Invalid parent");
        switch (folders.find(func(item) = item.id == parent and item.deleted_at_ms == null)) {
          case null { return #Err("Parent folder not found") };
          case (?parentFolder) {
            if (parentFolder.club != club) return #Err("Parent belongs to another club");
          };
        };
      };
      case null {};
    };
    if (folders.any(func(item) = item.id == id)) return #Err("Folder id already exists");
    let folder : Types.VaultFolder = {
      id; club; team; parent_id; name; restricted_roles;
      created_by = caller;
      created_at_ms = nowMs();
      deleted_at_ms = null;
      deleted_by = null;
      mini_league_id;
    };
    folders := folders.concat([folder]);
    #Ok(folder)
  };

  public shared ({ caller }) func update_folder(
    id : Text,
    name : Text,
    restricted_roles : [Text],
  ) : async { #Ok : Types.VaultFolder; #Err : Text } {
    auth(caller);
    if (not validLong(name, 160)) return #Err("Invalid folder name");
    if (not validRoles(restricted_roles)) return #Err("Invalid restricted roles");
    switch (folders.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("Folder not found") };
      case (?folder) {
        if (not isGovernor(caller) and not hasRole(caller, folder.club, folder.team)) return #Err("Club role required");
        let updated : Types.VaultFolder = { folder with name; restricted_roles };
        folders := folders.map(func(item) = if (item.id == id) { updated } else { item });
        #Ok(updated)
      };
    }
  };

  // Soft delete. Refuses while the folder still has live subfolders or files
  // so the tree never orphans live content.
  public shared ({ caller }) func delete_folder(id : Text) : async { #Ok : Types.VaultFolder; #Err : Text } {
    auth(caller);
    switch (folders.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("Folder not found") };
      case (?folder) {
        if (not isGovernor(caller) and not hasRole(caller, folder.club, folder.team)) return #Err("Club role required");
        if (folders.any(func(item) = item.parent_id == ?id and item.deleted_at_ms == null)) return #Err("Folder has subfolders");
        if (files.any(func(item) = item.folder_id == id and item.deleted_at_ms == null)) return #Err("Folder has files");
        let updated : Types.VaultFolder = { folder with deleted_at_ms = ?nowMs(); deleted_by = ?caller };
        folders := folders.map(func(item) = if (item.id == id) { updated } else { item });
        #Ok(updated)
      };
    }
  };

  // mini_league_id filters to one mini league's folders; null returns all
  // folders in the club/team scope. Folders with restricted_roles are hidden
  // from callers who don't hold one of the listed roles.
  public query ({ caller }) func list_folders(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFolder]; #Err : Text } {
    auth(caller);
    #Ok(folders.filter(func(item) =
      item.club == club and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and
      (mini_league_id == null or item.mini_league_id == mini_league_id) and
      canViewFolder(caller, item)))
  };

  public shared ({ caller }) func register_file(
    id : Text,
    folder_id : Text,
    club : Text,
    team : ?Text,
    name : Text,
    file_url : Text,
    size : Nat64,
    mime : Text,
    is_external_link : Bool,
    blob_ref : ?Types.BlobRef,
    mini_league_id : ?Text,
  ) : async { #Ok : Types.VaultFile; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, club, team)) return #Err("Club role required");
    if (not valid(id) or not valid(folder_id) or not valid(club)) return #Err("Invalid file fields");
    if (not validLong(name, 160) or not validLong(file_url, 2048) or not validLong(mime, 128)) return #Err("Invalid file fields");
    switch (team) { case (?t) { if (not valid(t)) return #Err("Invalid team") }; case null {} };
    switch (mini_league_id) { case (?m) { if (not valid(m)) return #Err("Invalid mini league") }; case null {} };
    switch (blob_ref) { case (?ref) { if (not validBlobRef(ref)) return #Err("Invalid blob ref") }; case null {} };
    switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
      case null { return #Err("Folder not found") };
      case (?folder) {
        if (folder.club != club) return #Err("Folder belongs to another club");
      };
    };
    if (files.any(func(item) = item.id == id)) return #Err("File id already exists");
    let file : Types.VaultFile = {
      id; folder_id; club; team; name; file_url; size; mime;
      uploaded_by = caller;
      created_at_ms = nowMs();
      deleted_at_ms = null;
      deleted_by = null;
      mini_league_id;
      is_external_link; blob_ref;
    };
    files := files.concat([file]);
    #Ok(file)
  };

  public query ({ caller }) func list_files(folder_id : Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    auth(caller);
    #Ok(files.filter(func(item) = item.folder_id == folder_id and item.deleted_at_ms == null))
  };

  public query ({ caller }) func list_club_files(club : Text, team : ?Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    auth(caller);
    #Ok(files.filter(func(item) =
      item.club == club and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null)))
  };

  public shared ({ caller }) func trash_file(id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not isGovernor(caller) and not hasRole(caller, file.club, file.team)) return #Err("Club role required");
        let updated : Types.VaultFile = { file with deleted_at_ms = ?nowMs() };
        files := files.map(func(item) = if (item.id == id) { updated } else { item });
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func restore_file(id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms != null)) {
      case null { #Err("Trashed file not found") };
      case (?file) {
        if (not isGovernor(caller) and not hasRole(caller, file.club, file.team)) return #Err("Club role required");
        let updated : Types.VaultFile = { file with deleted_at_ms = null };
        files := files.map(func(item) = if (item.id == id) { updated } else { item });
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func rename_file(id : Text, name : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    auth(caller);
    if (not validLong(name, 160)) return #Err("Invalid file name");
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not isGovernor(caller) and not hasRole(caller, file.club, file.team)) return #Err("Club role required");
        let updated : Types.VaultFile = { file with name = name };
        files := files.map(func(item) = if (item.id == id) { updated } else { item });
        #Ok(updated)
      };
    }
  };

  // Moves a file into another folder of the same club and adopts that
  // folder's team scope. An empty folder_id moves the file to the vault
  // root (no folder) and leaves its team scope unchanged — provisional
  // until the vault scope model is verified post-deploy.
  public shared ({ caller }) func move_file(id : Text, folder_id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not isGovernor(caller) and not hasRole(caller, file.club, file.team)) return #Err("Club role required");
        if (folder_id == "") {
          let updated : Types.VaultFile = { file with folder_id = "" };
          files := files.map(func(item) = if (item.id == id) { updated } else { item });
          return #Ok(updated);
        };
        if (not valid(folder_id)) return #Err("Invalid folder");
        switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
          case null { #Err("Target folder not found") };
          case (?folder) {
            if (folder.club != file.club) return #Err("Target folder belongs to another club");
            let updated : Types.VaultFile = { file with folder_id = folder_id; team = folder.team };
            files := files.map(func(item) = if (item.id == id) { updated } else { item });
            #Ok(updated)
          };
        }
      };
    }
  };

  // Hard delete — removes the metadata row outright. File bytes live outside
  // this canister (Supabase storage today, the blob store later), so byte
  // cleanup stays with the storage layer.
  public shared ({ caller }) func delete_file_permanent(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (files.find(func(item) = item.id == id)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not isGovernor(caller) and not hasRole(caller, file.club, file.team)) return #Err("Club role required");
        files := files.filter(func(item) = item.id != id);
        #Ok
      };
    }
  };

  public query ({ caller }) func list_trashed_files(club : Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    auth(caller);
    #Ok(files.filter(func(item) = item.club == club and item.deleted_at_ms != null))
  };
};
