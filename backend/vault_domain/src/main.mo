import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "types";

persistent actor class Main(governorInit : Principal) {
  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };

  var governor : Principal;
  var folders : [Types.VaultFolder];
  var files : [Types.VaultFile];
  var roles : [Types.RoleGrant];
  var club_domain_canister : ?Principal;
  var competition_domain_canister : ?Principal;

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };


  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
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

  type CompetitionVaultAccess = { club_id : Text; is_member : Bool; can_manage : Bool };

  func getCompetitionAccess(caller : Principal, competitionId : Text) : async ?CompetitionVaultAccess {
    switch (competition_domain_canister) {
      case null { null };
      case (?canister) {
        let competitionDomain : actor {
          get_vault_access : shared (Text, Principal) -> async { #Ok : CompetitionVaultAccess; #Err : Text };
        } = actor (Principal.toText(canister));
        let result = try {
          await competitionDomain.get_vault_access(competitionId, caller)
        } catch (_) {
          return null;
        };
        switch (result) {
          case (#Ok(access)) { ?access };
          case (#Err(_)) { null };
        }
      };
    }
  };

  // Write access: governor, a local vault role grant, or any role in the
  // club on club_domain (same check pii_access_control uses). Fail-closed
  // while club_domain is unwired.
  func canWrite(caller : Principal, club : Text, team : ?Text, competitionId : ?Text) : async Bool {
    switch (competitionId) {
      case (?id) {
        let access = await getCompetitionAccess(caller, id);
        return switch (access) {
          case null { false };
          case (?value) { value.club_id == club and value.is_member and value.can_manage };
        };
      };
      case null {};
    };
    if (isGovernor(caller) or hasRole(caller, club, team)) return true;
    switch (club_domain_canister) {
      case null { false };
      case (?cid) {
        let cd : actor { has_club_staff_role : shared query (Principal, Text) -> async Bool } = actor (Principal.toText(cid));
        try { await cd.has_club_staff_role(caller, club) } catch (_) { false }
      };
    }
  };

  public shared ({ caller }) func set_club_domain_canister(canister : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can set club_domain canister");
    club_domain_canister := ?canister;
    #Ok
  };

  public shared ({ caller }) func set_competition_domain_canister(canister : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can set competition_domain canister");
    if (canister.equal(Principal.anonymous())) return #Err("Invalid canister id");
    competition_domain_canister := ?canister;
    #Ok
  };

  // NOTE: access control is club-scoped via role grants assigned by the
  // governor. Like the other domain canisters, the browser-supplied club and
  // team ids are trusted text until account ids are bound to principals via
  // identity_access — see roadmap.

  // A folder with restricted_roles is visible only to the governor or a
  // caller holding one of the listed roles within the folder's club/team
  // scope. Empty restricted_roles means visible to any club member.
  // Breadcrumb of folder names from root to `folder`, newest ancestor last.
  // Bounded by depth 32 to avoid runaway loops on a corrupted parent chain.
  func folderPath(folder : Types.VaultFolder) : [Text] {
    var names : [Text] = [folder.name];
    var current = folder;
    var guard = 0;
    label walking loop {
      guard += 1;
      if (guard > 32) break walking;
      switch (current.parent_id) {
        case null { break walking };
        case (?parentId) {
          switch (folders.find(func(item) = item.id == parentId)) {
            case null { break walking };
            case (?parent) { names := Array.concat([parent.name], names); current := parent };
          };
        };
      };
    };
    names
  };

  // Joins a file with its folder's display name/path for the vault browser,
  // which otherwise has to issue a second lookup per file. A file with no
  // (or a deleted) folder returns null name/path — same as vault root.
  func withFolderJoin(file : Types.VaultFile) : Types.VaultFileWithFolder {
    switch (folders.find(func(item) = item.id == file.folder_id)) {
      case null { { file; folder_name = null; folder_path = [] } };
      case (?folder) { { file; folder_name = ?folder.name; folder_path = folderPath(folder) } };
    }
  };

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
    competition_id : ?Text,
    sort_order : Nat32,
    description : ?Text,
    color : ?Text,
  ) : async { #Ok : Types.VaultFolder; #Err : Text } {
    auth(caller);
    if (not (await canWrite(caller, club, team, competition_id))) return #Err("Club or competition admin required");
    if (not valid(id) or not valid(club) or not validLong(name, 160)) return #Err("Invalid folder fields");
    if (not validRoles(restricted_roles)) return #Err("Invalid restricted roles");
    switch (team) { case (?t) { if (not valid(t)) return #Err("Invalid team") }; case null {} };
    switch (mini_league_id) { case (?m) { if (not valid(m)) return #Err("Invalid mini league") }; case null {} };
    switch (competition_id) {
      case (?competitionId) {
        if (not valid(competitionId) or team != null or mini_league_id != null) return #Err("Invalid competition scope");
        let access = await getCompetitionAccess(caller, competitionId);
        switch (access) {
          case null { return #Err("Competition access unavailable") };
          case (?value) { if (value.club_id != club or not value.can_manage) return #Err("Competition admin required") };
        };
      };
      case null {};
    };
    switch (description) { case (?d) { if (not validLong(d, 500)) return #Err("Invalid description") }; case null {} };
    switch (color) { case (?c) { if (not validLong(c, 32)) return #Err("Invalid color") }; case null {} };
    switch (parent_id) {
      case (?parent) {
        if (not valid(parent)) return #Err("Invalid parent");
        switch (folders.find(func(item) = item.id == parent and item.deleted_at_ms == null)) {
          case null { return #Err("Parent folder not found") };
          case (?parentFolder) {
            if (parentFolder.club != club) return #Err("Parent belongs to another club");
            if (parentFolder.competition_id != competition_id) return #Err("Parent belongs to another vault scope");
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
      competition_id;
      sort_order;
      description;
      color;
    };
    folders := folders.concat([folder]);
    #Ok(folder)
  };

  public shared ({ caller }) func update_folder(
    id : Text,
    name : Text,
    restricted_roles : [Text],
    sort_order : Nat32,
    description : ?Text,
    color : ?Text,
  ) : async { #Ok : Types.VaultFolder; #Err : Text } {
    auth(caller);
    if (not validLong(name, 160)) return #Err("Invalid folder name");
    if (not validRoles(restricted_roles)) return #Err("Invalid restricted roles");
    switch (description) { case (?d) { if (not validLong(d, 500)) return #Err("Invalid description") }; case null {} };
    switch (color) { case (?c) { if (not validLong(c, 32)) return #Err("Invalid color") }; case null {} };
    switch (folders.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("Folder not found") };
      case (?folder) {
        if (not (await canWrite(caller, folder.club, folder.team, folder.competition_id))) return #Err("Club or competition admin required");
        let updated : Types.VaultFolder = { folder with name; restricted_roles; sort_order; description; color };
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
        if (not (await canWrite(caller, folder.club, folder.team, folder.competition_id))) return #Err("Club or competition admin required");
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
      item.competition_id == null and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and
      (mini_league_id == null or item.mini_league_id == mini_league_id) and
      canViewFolder(caller, item)))
  };

  // Single-folder lookup, same visibility rule as list_folders: folders with
  // restricted_roles are invisible to callers lacking one of those roles.
  public query ({ caller }) func get_folder(id : Text) : async { #Ok : ?Types.VaultFolder; #Err : Text } {
    auth(caller);
    switch (folders.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Ok(null) };
      case (?folder) {
        if (folder.competition_id != null) return #Ok(null);
        if (not canViewFolder(caller, folder)) return #Ok(null);
        #Ok(?folder)
      };
    }
  };

  public shared ({ caller }) func list_competition_folders(competition_id : Text) : async { #Ok : [Types.VaultFolder]; #Err : Text } {
    auth(caller);
    let access = switch (await getCompetitionAccess(caller, competition_id)) {
      case null { return #Err("Competition access unavailable") };
      case (?value) value;
    };
    if (not access.is_member) return #Err("Competition membership required");
    #Ok(folders.filter(func(folder) =
      folder.competition_id == ?competition_id and
      folder.club == access.club_id and
      folder.deleted_at_ms == null and
      (folder.restricted_roles.size() == 0 or access.can_manage)
    ))
  };

  public shared ({ caller }) func get_competition_folder(id : Text) : async { #Ok : ?Types.VaultFolder; #Err : Text } {
    auth(caller);
    switch (folders.find(func(folder) = folder.id == id and folder.deleted_at_ms == null and folder.competition_id != null)) {
      case null { #Ok(null) };
      case (?folder) {
        let competitionId = switch (folder.competition_id) {
          case null { return #Ok(null) };
          case (?value) value;
        };
        let access = await getCompetitionAccess(caller, competitionId);
        switch (access) {
          case null { #Err("Competition access unavailable") };
          case (?value) {
            if (value.club_id != folder.club or not value.is_member) return #Ok(null);
            if (folder.restricted_roles.size() > 0 and not value.can_manage) return #Ok(null);
            #Ok(?folder)
          };
        }
      };
    }
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
    competition_id : ?Text,
  ) : async { #Ok : Types.VaultFile; #Err : Text } {
    auth(caller);
    if (not (await canWrite(caller, club, team, competition_id))) return #Err("Club or competition admin required");
    // folder_id "" = vault root (same convention as move_file).
    if (not valid(id) or folder_id.size() > 128 or not valid(club)) return #Err("Invalid file fields");
    if (not validLong(name, 160) or not validLong(file_url, 2048) or not validLong(mime, 128)) return #Err("Invalid file fields");
    switch (team) { case (?t) { if (not valid(t)) return #Err("Invalid team") }; case null {} };
    switch (mini_league_id) { case (?m) { if (not valid(m)) return #Err("Invalid mini league") }; case null {} };
    switch (competition_id) {
      case (?competitionId) {
        if (not valid(competitionId) or team != null or mini_league_id != null) return #Err("Invalid competition scope");
        let access = await getCompetitionAccess(caller, competitionId);
        switch (access) {
          case null { return #Err("Competition access unavailable") };
          case (?value) { if (value.club_id != club or not value.can_manage) return #Err("Competition admin required") };
        };
      };
      case null {};
    };
    switch (blob_ref) { case (?ref) { if (not validBlobRef(ref)) return #Err("Invalid blob ref") }; case null {} };
    if (folder_id != "") {
      switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
        case null { return #Err("Folder not found") };
        case (?folder) {
          if (folder.club != club) return #Err("Folder belongs to another club");
          if (folder.competition_id != competition_id) return #Err("Folder belongs to another vault scope");
        };
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
      competition_id;
      is_external_link; blob_ref;
    };
    files := files.concat([file]);
    #Ok(file)
  };

  // Single-file lookup, same visibility rule as list_files: a file whose
  // folder has restricted_roles is invisible to callers lacking one of
  // those roles. A file with no (deleted) folder is visible like vault root.
  public query ({ caller }) func get_file(id : Text) : async { #Ok : ?Types.VaultFile; #Err : Text } {
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Ok(null) };
      case (?file) {
        if (file.competition_id != null) return #Ok(null);
        switch (folders.find(func(item) = item.id == file.folder_id and item.deleted_at_ms == null)) {
          case (?folder) { if (not canViewFolder(caller, folder)) return #Ok(null) };
          case null {};
        };
        #Ok(?file)
      };
    }
  };

  public query ({ caller }) func list_files(folder_id : Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    auth(caller);
    switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
      case (?folder) {
        if (folder.competition_id != null or not canViewFolder(caller, folder)) return #Ok([]);
      };
      case null {};
    };
    #Ok(files.filter(func(item) = item.folder_id == folder_id and item.deleted_at_ms == null and item.competition_id == null))
  };

  // Folder-joined counterpart of list_files for the vault browser's folder
  // path/name breadcrumbs — same visibility rules as list_files.
  public query ({ caller }) func list_files_with_folder(folder_id : Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    auth(caller);
    switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
      case (?folder) {
        if (folder.competition_id != null or not canViewFolder(caller, folder)) return #Ok([]);
      };
      case null {};
    };
    #Ok(files.filter(func(item) = item.folder_id == folder_id and item.deleted_at_ms == null and item.competition_id == null).map(withFolderJoin))
  };

  public shared ({ caller }) func list_competition_files_with_folder(folder_id : Text, competition_id : Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    auth(caller);
    let access = switch (await getCompetitionAccess(caller, competition_id)) {
      case null { return #Err("Competition access unavailable") };
      case (?value) value;
    };
    if (not access.is_member) return #Err("Competition membership required");
    if (folder_id != "") {
      switch (folders.find(func(folder) = folder.id == folder_id and folder.deleted_at_ms == null)) {
        case null { return #Err("Folder not found") };
        case (?folder) {
          if (folder.competition_id != ?competition_id or folder.club != access.club_id) return #Err("Competition folder scope mismatch");
          if (folder.restricted_roles.size() > 0 and not access.can_manage) return #Err("Folder access forbidden");
        };
      };
    };
    #Ok(files.filter(func(file) =
      file.competition_id == ?competition_id and
      file.folder_id == folder_id and
      file.deleted_at_ms == null
    ).map(withFolderJoin))
  };

  public query ({ caller }) func list_club_files(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    auth(caller);
    #Ok(files.filter(func(item) =
      item.club == club and
      item.competition_id == null and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and
      (mini_league_id == null or item.mini_league_id == mini_league_id) and
      (switch (folders.find(func(f) = f.id == item.folder_id)) {
        case null { true };
        case (?folder) { canViewFolder(caller, folder) };
      })))
  };

  // Folder-joined counterpart of list_club_files — same filters/visibility.
  public query ({ caller }) func list_club_files_with_folder(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    auth(caller);
    #Ok(files.filter(func(item) =
      item.club == club and
      item.competition_id == null and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and
      (mini_league_id == null or item.mini_league_id == mini_league_id) and
      (switch (folders.find(func(f) = f.id == item.folder_id)) {
        case null { true };
        case (?folder) { canViewFolder(caller, folder) };
      })).map(withFolderJoin))
  };

  public shared ({ caller }) func trash_file(id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        let updated : Types.VaultFile = { file with deleted_at_ms = ?nowMs(); deleted_by = ?caller };
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
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        let updated : Types.VaultFile = { file with deleted_at_ms = null; deleted_by = null };
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
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
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
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
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
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        files := files.filter(func(item) = item.id != id);
        #Ok
      };
    }
  };

  public query ({ caller }) func list_trashed_files(club : Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    auth(caller);
    #Ok(files.filter(func(item) = item.club == club and item.deleted_at_ms != null and item.competition_id == null))
  };

  // Folder-joined counterpart of list_trashed_files, for the trash view's
  // "was in <folder>" breadcrumb.
  public query ({ caller }) func list_trashed_files_with_folder(club : Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    auth(caller);
    #Ok(files.filter(func(item) = item.club == club and item.deleted_at_ms != null and item.competition_id == null).map(withFolderJoin))
  };
};
