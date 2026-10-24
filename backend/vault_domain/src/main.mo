import AccountAdmission "../../shared/AccountAdmission";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import Error "mo:core/Error";
import MediaEvidence "../../shared/MediaEvidence";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Option "mo:core/Option";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import Types "types";
import PinScope "pinScope";
import BackupPages "backupPages";
import UploadJournal "uploadJournal";
import ErasureFolders "erasureFolders";

persistent actor class Main(governorInit : Principal) = this {
  // Opt-in local rehearsal only; production deploy scripts must never set these.
  transient let accountAdmissionEnabled = Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == ?"1";
  transient let accountAdmissionAuthority = switch (Runtime.envVar<system>("IGNITE_ACCOUNT_SERVICE_IDENTITY")) {
    case (?id) ?Principal.fromText(id); case null null
  };
  var removal_intents : Map.Map<Text, RemovalReceiver.Request>;
  var removal_subjects : Map.Map<Principal, Text>;
  var removal_active : Map.Map<Principal, Nat>;
  transient let removalReceiver = RemovalReceiver.Gate(accountAdmissionEnabled, accountAdmissionAuthority, removal_intents, removal_subjects, removal_active);
  transient let accountAdmission = AccountAdmission.Gate(accountAdmissionEnabled, accountAdmissionAuthority);
  func admitAccount(subject : Principal) : async () {
    if (removalReceiver.denied(subject)) throw Error.reject("Account removal fenced");
    let eligible = await accountAdmission.eligible(subject);
    if (removalReceiver.denied(subject) or not eligible) throw Error.reject("Account admission denied or unavailable");
  };
  func denyLegacyAccountQuery() {
    Runtime.trap("Use protected consensus account read");
  };

  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };
  public shared ({ caller }) func read_group_opening_configuration() : async [(Text, Text)] {
    if (not isGovernor(caller)) Runtime.trap("Governor required");
    [("club_domain", OpeningConfiguration.optional(club_domain_canister)),
     ("competition_domain", OpeningConfiguration.optional(competition_domain_canister))]
  };
  // Live memory reading for the admin health page (public, like cycles_balance).
  public query func memory_stats() : async { heap_bytes : Nat; memory_bytes : Nat; stable_bytes : Nat } {
    {
      heap_bytes = PrimMem.rts_heap_size();
      memory_bytes = PrimMem.rts_memory_size();
      stable_bytes = PrimMem.nat64ToNat(PrimMem.stableMemorySize()) * 65536;
    }
  };

  var governor : Principal;
  var mediaEvidenceRevision : Nat;
  var folders : [Types.VaultFolder];
  var files : [Types.VaultFile];
  var galleryMediaAuthority : ?Principal;
  var gallerySourceFiles : Map.Map<Text, Text>;
  transient let galleryCopyLocks = Map.empty<Text, Bool>();
  var roles : [Types.RoleGrant];
  var club_domain_canister : ?Principal;
  var competition_domain_canister : ?Principal;
  var pinned_vaults : [Types.PinnedVault];
  var backups : [Types.Backup];
  var transferFences : [Text];
  var nextBackupSeq : Nat64;
  var nextGalleryFileSeq : Nat;
  var messagingDomainCanister : ?Principal;
  var vaultStores : [Principal];
  var deletionIntents : Map.Map<Text, Text>;
  type CleanupRecord = { club : Text; team : ?Text; competition : ?Text; blob_ref : Types.BlobRef; state : { #pending; #erased; #complete } };
  var cleanupRecords : Map.Map<Text, CleanupRecord>;
  var uploadIntents : Map.Map<Text, UploadJournal.Intent>;
  var lifecycleFileCursor : Nat;
  var lifecycleCleanupCursor : Text;
  var lifecycleFolderCursor : Nat;
  transient var lifecycleRunning = false;
  var backupRestoreProgress : Map.Map<Text, { next : Nat; restored : Nat; skipped : Nat; complete : Bool }>;
  transient let backupRestoreLocks = Map.empty<Text, Bool>();

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

  // Platform-only (governor or an app_admin role grant with no club/team
  // scope) — never a club role, so a club admin cannot export/restore every
  // club's vault metadata.
  func isAppAdmin(caller : Principal) : Bool {
    isGovernor(caller) or roles.any(func(grant) =
      grant.user.equal(caller) and grant.role == "app_admin" and grant.club_id == null and grant.team_id == null)
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
        // Every delegated single/batch read and write uses this helper.
        // Discard a reply from a replaced authority or removed human.
        await admitAccount(caller);
        if (competition_domain_canister != ?canister) return null;
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
    await admitAccount(caller);
    if (isFenced(club)) return false;
    switch (competitionId) {
      case (?id) {
        let configured = competition_domain_canister;
        let access = await getCompetitionAccess(caller, id);
        await admitAccount(caller);
        if (isFenced(club) or configured != competition_domain_canister) return false;
        return switch (access) {
          case null { false };
          case (?value) { value.club_id == club and value.is_member and value.can_manage };
        };
      };
      case null {};
    };
    if (isGovernor(caller)) return true;
    let grants = await currentRoles(caller, club);
    not isFenced(club) and grants.any(func g =
      (g.0 == "club_admin" or g.0 == "committee_member" or g.0 == "coach" or g.0 == "team_admin" or g.0 == "league_admin") and
      (g.1 == null or (team != null and g.1 == team)))
  };

  func currentRoles(caller : Principal, club : Text) : async [(Text, ?Text)] {
    let cid = club_domain_canister ?? return [];
    let cd : actor { read_account_list_user_club_roles : shared (Principal, Text) -> async [(Text, ?Text)] } = actor(cid.toText());
    let grants = try { await (with timeout = 10) cd.read_account_list_user_club_roles(caller, club) } catch (_) { return [] };
    await admitAccount(caller);
    if (club_domain_canister != ?cid or isFenced(club)) return [];
    grants
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

  func folderVisible(caller : Principal, folder : Types.VaultFolder, grants : [(Text, ?Text)]) : Bool {
    var current = folder;
    var visited : [Text] = [];
    loop {
      if (visited.size() >= 32 or visited.any(func id = id == current.id)) return false;
      visited := visited.concat([current.id]);
      if (current.deleted_at_ms != null or current.club != folder.club or current.competition_id != folder.competition_id) return false;
      if (not isGovernor(caller) and current.restricted_roles.size() > 0 and not grants.any(func g =
        (g.1 == null or g.1 == current.team) and current.restricted_roles.any(func role = role == g.0))) return false;
      switch (current.parent_id) {
        case null return true;
        case (?id) { current := folders.find(func f = f.id == id) ?? return false }
      }
    }
  };
  // Legacy queries always refuse; only consensus paths use fresh authority.
  func canViewFolder(caller : Principal, folder : Types.VaultFolder) : Bool {
    folderVisible(caller, folder, roles.filter(func g = g.user.equal(caller) and g.club_id == ?folder.club).map(func g = (g.role, g.team_id)))
  };
  func canAccessFolder(caller : Principal, folder : Types.VaultFolder) : async Bool {
    let grants = await currentRoles(caller, folder.club);
    folders.find(func f = f.id == folder.id) == ?folder and folderVisible(caller, folder, grants)
  };


  // ---- Club transfer fence + snapshot (governor-only operator tooling) ----
  func isFenced(club : Text) : Bool = transferFences.any(func(c) = c == club);
  func folderFenced(id : Text) : Bool = folders.any(func(f) = f.id == id and isFenced(f.club));
  func fileFenced(id : Text) : Bool = files.any(func(f) = f.id == id and isFenced(f.club));
  type VaultSnapshot = { folders : [Types.VaultFolder]; files : [Types.VaultFile] };

  public shared ({ caller }) func set_transfer_fence(club : Text, fenced : Bool) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    mediaEvidenceRevision += 1;
    transferFences := transferFences.filter(func(c) = c != club);
    mediaEvidenceRevision += 1;
    if (fenced) transferFences := transferFences.concat([club]);
    #Ok
  };

  public query ({ caller }) func export_club_snapshot(club : Text) : async { #Ok : Blob; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before export");
    let snap : VaultSnapshot = { folders = folders.filter(func(f) = f.club == club); files = files.filter(func(f) = f.club == club) };
    #Ok(to_candid (snap))
  };

  public shared ({ caller }) func import_club_snapshot(club : Text, snapshot : Blob) : async { #Ok : Nat; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before import");
    let decoded : ?VaultSnapshot = from_candid (snapshot);
    let snap = switch (decoded) { case (?x) x; case null return #Err("Invalid snapshot") };
    if (snap.folders.any(func(f) = f.club != club) or snap.files.any(func(f) = f.club != club)) return #Err("Snapshot contains foreign records");
    // Ids must not collide with another club's records on this canister.
    if (snap.folders.any(func(f) = folders.any(func(x) = x.id == f.id and x.club != club))
        or snap.files.any(func(f) = files.any(func(x) = x.id == f.id and x.club != club))) return #Err("Snapshot id collides with another club");
    folders := folders.filter(func(f) = f.club != club).concat(snap.folders);
    mediaEvidenceRevision += 1;
    files := files.filter(func(f) = f.club != club).concat(snap.files);
    #Ok(snap.folders.size() + snap.files.size())
  };

  public shared ({ caller }) func purge_club_snapshot(club : Text) : async { #Ok : Nat; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before purge");
    let before = folders.size() + files.size();
    folders := folders.filter(func(f) = f.club != club);
    mediaEvidenceRevision += 1;
    files := files.filter(func(f) = f.club != club);
    #Ok(before - folders.size() - files.size())
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club)) return #Err("Club is temporarily locked for a transfer");
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
            if (parentFolder.competition_id != competition_id or parentFolder.team != team or parentFolder.mini_league_id != mini_league_id) return #Err("Parent belongs to another vault scope");
            if (competition_id == null and not (await canAccessFolder(caller, parentFolder))) return #Err("Parent access forbidden");
            if (folders.find(func f = f.id == parent) != ?parentFolder) return #Err("Parent changed");
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
    folders := folders.concat([folder]); mediaEvidenceRevision += 1;
    #Ok(folder)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func update_folder(
    id : Text,
    name : Text,
    restricted_roles : [Text],
    sort_order : Nat32,
    description : ?Text,
    color : ?Text,
  ) : async { #Ok : Types.VaultFolder; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (folderFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validLong(name, 160)) return #Err("Invalid folder name");
    if (not validRoles(restricted_roles)) return #Err("Invalid restricted roles");
    switch (description) { case (?d) { if (not validLong(d, 500)) return #Err("Invalid description") }; case null {} };
    switch (color) { case (?c) { if (not validLong(c, 32)) return #Err("Invalid color") }; case null {} };
    switch (folders.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("Folder not found") };
      case (?folder) {
        if (not (await canWrite(caller, folder.club, folder.team, folder.competition_id))) return #Err("Club or competition admin required");
        if (folder.competition_id == null and not (await canAccessFolder(caller, folder))) return #Err("Folder access forbidden");
        if (folderFenced(id) or folders.find(func(f) = f.id == id) != ?folder) return #Err("Folder changed during authorization");
        let updated : Types.VaultFolder = { folder with name; restricted_roles; sort_order; description; color };
        folders := folders.map(func(item) = if (item.id == id) { updated } else { item }); mediaEvidenceRevision += 1;
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Soft delete. Refuses while the folder still has live subfolders or files
  // so the tree never orphans live content.
  public shared ({ caller }) func delete_folder(id : Text) : async { #Ok : Types.VaultFolder; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (folderFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (folders.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("Folder not found") };
      case (?folder) {
        if (not (await canWrite(caller, folder.club, folder.team, folder.competition_id))) return #Err("Club or competition admin required");
        if (folder.competition_id == null and not (await canAccessFolder(caller, folder))) return #Err("Folder access forbidden");
        if (folderFenced(id) or folders.find(func(f) = f.id == id) != ?folder) return #Err("Folder changed during authorization");
        if (folders.any(func(item) = item.parent_id == ?id and item.deleted_at_ms == null)) return #Err("Folder has subfolders");
        if (files.any(func(item) = item.folder_id == id and item.deleted_at_ms == null)) return #Err("Folder has files");
        let updated : Types.VaultFolder = { folder with deleted_at_ms = ?nowMs(); deleted_by = ?caller };
        folders := folders.map(func(item) = if (item.id == id) { updated } else { item }); mediaEvidenceRevision += 1;
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // mini_league_id filters to one mini league's folders; null returns all
  // folders in the club/team scope. Folders with restricted_roles are hidden
  // from callers who don't hold one of the listed roles.
  public query ({ caller }) func list_folders(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFolder]; #Err : Text } {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
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

  // Location-only, fresh authority check. Includes trash and competition
  // items so restore/share dispatch never guesses their owning club.
  public shared ({ caller }) func read_resource_club(kind : Text, id : Text) : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller); if (not valid(id)) return #Err("Invalid id");
    let folder = if (kind == "folder") folders.find(func(f) = f.id == id) else null;
    let file = if (kind == "file") files.find(func(f) = f.id == id) else null;
    let club = switch (folder) { case (?f) f.club; case null switch (file) { case (?f) f.club; case null return #Ok(null) } };
    let competition = switch (folder) { case (?f) f.competition_id; case null switch (file) { case (?f) f.competition_id; case null null } };
    switch (competition) {
      case (?cid) { switch (await getCompetitionAccess(caller, cid)) { case (?a) if (not a.is_member or a.club_id != club) return #Ok(null); case null return #Err("Competition authority unavailable") } };
      case null {
        if (not isGovernor(caller)) {
          if (not (await currentClubMember(caller, club))) return #Ok(null);
          switch (folder) { case (?f) if (not (await canAccessFolder(caller, f))) return #Ok(null); case null switch (file) { case (?f) switch (folders.find(func(p) = p.id == f.folder_id)) { case (?p) if (not (await canAccessFolder(caller, p))) return #Ok(null); case null {} }; case null {} } };
        }
      };
    };
    if (isFenced(club)) return #Ok(null);
    if (folder != null and folders.find(func(f) = f.id == id) != folder) return #Ok(null);
    if (file != null and files.find(func(f) = f.id == id) != file) return #Ok(null);
    #Ok(?club)
  
    } finally { removalReceiver.leave(caller) };
  };

  func competitionFolderVisible(caller : Principal, f : Types.VaultFolder, access : CompetitionVaultAccess) : Bool {
    if (not access.is_member or f.club != access.club_id) return false;
    var current = f; var visited : [Text] = [];
    loop {
      if (visited.size() >= 32 or visited.any(func id = id == current.id) or current.deleted_at_ms != null or current.club != f.club or current.competition_id != f.competition_id or (current.restricted_roles.size() > 0 and not access.can_manage)) return false;
      visited := visited.concat([current.id]);
      switch (current.parent_id) { case null return true; case (?id) current := folders.find(func p = p.id == id) ?? return false }
    }
  };
  public shared ({ caller }) func list_competition_folders(competition_id : Text) : async { #Ok : [Types.VaultFolder]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
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
      competitionFolderVisible(caller, folder, access)
    ))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func get_competition_folder(id : Text) : async { #Ok : ?Types.VaultFolder; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
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
            if (not competitionFolderVisible(caller, folder, value) or folders.find(func f = f.id == id) != ?folder) return #Ok(null);
            #Ok(?folder)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_gallery_media_authority(id : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or Principal.isAnonymous(id)) return #Err("Governor and valid authority required");
    galleryMediaAuthority := ?id; #Ok
  };
  type GallerySource = { id : Text; club_id : Text; owner : Principal; team_id : ?Text; mime : Text; storage_path : Text; blob_ref : ?Types.BlobRef };
  func gallerySource(user : Principal, source : Text) : async { #Ok : GallerySource; #Err : Text } {
    let id = galleryMediaAuthority ?? return #Err("Media authority not configured");
    let media : actor { read_gallery_asset_for_service : shared (Principal, Text) -> async { #Ok : GallerySource; #Err : Text } } = actor(id.toText());
    let result = await (with timeout = 10) media.read_gallery_asset_for_service(user, source);
    if (galleryMediaAuthority != ?id) return #Err("Media authority changed"); result
  };
  public shared ({ caller }) func get_gallery_copy(source : Text) : async { #Ok : ?Types.VaultFile; #Err : Text } {
    await admitAccount(caller);
    let a = switch (await gallerySource(caller, source)) { case (#Err(e)) return #Err(e); case (#Ok(a)) a };
    if (not a.owner.equal(caller) and not (await canWrite(caller, a.club_id, a.team_id, null))) return #Err("Gallery owner or scoped staff required");
    let current = switch (await gallerySource(caller, source)) { case (#Err(e)) return #Err(e); case (#Ok(row)) row };
    if (current != a or isFenced(a.club_id) or removalReceiver.denied(caller)) return #Err("Gallery access changed");
    #Ok(switch (gallerySourceFiles.get(source)) { case (?id) files.find(func f = f.id == id); case null null })
  };
  public shared ({ caller }) func register_gallery_copy(source : Text, name : Text, file_url : Text, size : Nat64, mime : Text, blob_ref : Types.BlobRef) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    if (galleryCopyLocks.get(source) == ?true) { removalReceiver.leave(caller); return #Err("Gallery copy in progress") };
    galleryCopyLocks.add(source, true);
    try {
      await admitAccount(caller);
      let a = switch (await gallerySource(caller, source)) { case (#Err(e)) return #Err(e); case (#Ok(a)) a };
      if (not a.owner.equal(caller) or isFenced(a.club_id)) return #Err("Gallery owner required");
      switch (gallerySourceFiles.get(source)) { case (?id) { return #Ok(files.find(func f = f.id == id) ?? return #Err("Gallery copy was removed")) }; case null {} };
      let clubId = club_domain_canister ?? return #Err("Club authority not configured");
      let club : actor { get_media_allowance : shared query (Text, ?Text) -> async { #Ok : { premium : Bool }; #Err : Text } } = actor(clubId.toText());
      let allowance = await (with timeout = 10) club.get_media_allowance(a.club_id, a.team_id);
      switch allowance { case (#Ok(s)) { if (not s.premium) return #Err("Scoped Pro required") }; case (#Err(e)) return #Err(e) };
      if (club_domain_canister != ?clubId or isFenced(a.club_id) or removalReceiver.denied(caller)) return #Err("Gallery copy access changed");
      if (not validLong(name, 160) or not validLong(file_url, 2048) or not validBlobRef(blob_ref) or size > 10_485_760 or not Text.startsWith(blob_ref.path, #text ("clubs/" # a.club_id # "/vault/"))) return #Err("Invalid private gallery copy");
      if (switch (a.blob_ref) { case (?ref) ref.path == blob_ref.path and ref.canister == blob_ref.canister; case null false }) return #Err("Vault copy requires separate encrypted bytes");
      let original = a.blob_ref ?? return #Err("Gallery source has no configured store");
      if (blob_ref.canister != original.canister) return #Err("Gallery copy store mismatch");
      if (not (await verifyFileBytes(caller, blob_ref, size))) return #Err("Private copy not acknowledged by source store");
      // Recheck source access after every external authorization await.
      let current = switch (await gallerySource(caller, source)) { case (#Err(e)) return #Err(e); case (#Ok(row)) row };
      if (current != a or isFenced(a.club_id) or removalReceiver.denied(caller)) return #Err("Gallery source changed");
      let folder_id = "gallery-uploads-" # a.club_id # (a.team_id ?? "");
      if (not folders.any(func f = f.id == folder_id)) {
        let folder : Types.VaultFolder = { id = folder_id; club = a.club_id; team = a.team_id; parent_id = null; name = "Gallery Uploads"; restricted_roles = []; created_by = caller; created_at_ms = nowMs(); deleted_at_ms = null; deleted_by = null; mini_league_id = null; competition_id = null; sort_order = 0; description = null; color = null };
        folders := folders.concat([folder])
      };
      var copyId = "gallery-file-" # Nat.toText(nextGalleryFileSeq);
      nextGalleryFileSeq += 1;
      while (files.any(func f = f.id == copyId)) { copyId := "gallery-file-" # Nat.toText(nextGalleryFileSeq); nextGalleryFileSeq += 1 };
      let file : Types.VaultFile = { id = copyId; folder_id; club = a.club_id; team = a.team_id; name; file_url; size; mime; uploaded_by = caller; created_at_ms = nowMs(); deleted_at_ms = null; deleted_by = null; mini_league_id = null; competition_id = null; is_external_link = false; blob_ref = ?blob_ref };
      files := files.concat([file]); gallerySourceFiles.add(source, file.id); mediaEvidenceRevision += 1; #Ok(file)
    } finally { galleryCopyLocks.remove(source); removalReceiver.leave(caller) }
  };
  public shared ({ caller }) func trash_gallery_copy(user : Principal, source : Text, club : Text) : async { #Ok : Bool; #Err : Text } {
    if (galleryMediaAuthority != ?caller or isFenced(club)) return #Err("Media authority required");
    await admitAccount(user);
    let id = gallerySourceFiles.get(source) ?? return #Ok(false);
    let file = files.find(func f = f.id == id and f.club == club) ?? return #Err("Gallery copy scope mismatch");
    if (not file.uploaded_by.equal(user) and not (await canWrite(user, club, file.team, file.competition_id))) return #Err("Gallery owner or scoped staff required");
    if (galleryMediaAuthority != ?caller or isFenced(club) or removalReceiver.denied(user) or files.find(func f = f.id == id) != ?file) return #Err("Gallery copy changed");
    if (file.deleted_at_ms == null) { files := files.map(func f = if (f.id == id) ({ f with deleted_at_ms = ?nowMs(); deleted_by = ?user }) else f); mediaEvidenceRevision += 1 };
    #Ok(true)
  };

  public shared ({ caller }) func set_vault_stores(ids : [Principal]) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or ids.size() == 0 or ids.size() > 64 or ids.any(func id = id.equal(Principal.anonymous()) or id.toText() == "aaaaa-aa")) return #Err("Governor and valid stores required");
    vaultStores := ids; #Ok
  };
  func verifyFileBytes(user : Principal, ref : Types.BlobRef, size : Nat64) : async Bool {
    let pinned = vaultStores;
    if (blobCleanupPending(ref)) return false;
    if (not pinned.any(func id = id.toText() == ref.canister)) return false;
    let store : actor { read_vault_blob_evidence : shared (Principal, Text) -> async { #Ok : { owner : Principal; size : Nat; content_hash : Text }; #Err : Text } } = actor(ref.canister);
    let evidence = try { await (with timeout = 10) store.read_vault_blob_evidence(user, ref.path) } catch (_) { return false };
    await admitAccount(user);
    if (vaultStores != pinned or blobCleanupPending(ref)) return false;
    switch evidence { case (#Ok(e)) e.content_hash == ref.content_hash and e.size == size.toNat(); case (#Err(_)) false }
  };
  func blobCleanupPending(ref : Types.BlobRef) : Bool {
    cleanupRecords.entries().any(func entry = entry.1.state != #complete and entry.1.blob_ref.canister == ref.canister and entry.1.blob_ref.path == ref.path)
  };

  // Before encryption leaves the device, bind the exact ciphertext hash, store,
  // destination and original file identity. Unknown results never release the path.
  public shared ({ caller }) func begin_file_upload(file : Types.VaultFile) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      auth(caller); await admitAccount(caller);
      if (not file.uploaded_by.equal(caller) or file.is_external_link or file.deleted_at_ms != null or file.deleted_by != null) return #Err("Invalid upload subject");
      if (not valid(file.id) or not valid(file.club) or file.folder_id.size() > 128 or not validLong(file.name, 160) or not validLong(file.mime, 128) or file.size > 10_485_760) return #Err("Invalid upload fields");
      let ref = file.blob_ref ?? return #Err("Upload provenance required");
      switch (file.team) { case (?id) { if (not valid(id) or not ref.path.startsWith(#text ("clubs/" # file.club # "/vault/teams/" # id # "/"))) return #Err("Team upload path mismatch") }; case null { if (ref.path.startsWith(#text ("clubs/" # file.club # "/vault/teams/"))) return #Err("Unscoped team path") } };
      switch (file.competition_id) { case (?id) if (not valid(id) or file.team != null or file.mini_league_id != null) return #Err("Invalid competition scope"); case null {} };
      switch (file.mini_league_id) { case (?id) if (not valid(id)) return #Err("Invalid league scope"); case null {} };
      if (not validBlobRef(ref) or not vaultStores.any(func s = s.toText() == ref.canister) or not ref.path.startsWith(#text ("clubs/" # file.club # "/vault/")) or file.file_url != "https://" # ref.canister # ".raw.icp0.io/" # ref.path) return #Err("Original private store required");
      if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Scoped staff required");
      var destination : ?Types.VaultFolder = null;
      if (file.folder_id != "") {
        let folder = folders.find(func f = f.id == file.folder_id and f.deleted_at_ms == null) ?? return #Err("Folder unavailable");
        if (folder.club != file.club or folder.team != file.team or folder.competition_id != file.competition_id or folder.mini_league_id != file.mini_league_id) return #Err("Destination scope mismatch");
        if (file.competition_id == null and not (await canAccessFolder(caller, folder))) return #Err("Folder access forbidden");
        destination := ?folder
      };
      if (not (await canWrite(caller, file.club, file.team, file.competition_id)) or isFenced(file.club) or removalReceiver.denied(caller) or not vaultStores.any(func s = s.toText() == ref.canister) or blobCleanupPending(ref) or deletionIntents.get(file.id) != null) return #Err("Upload scope changed");
      switch destination { case (?f) if (folders.find(func row = row.id == f.id) != ?f) return #Err("Destination changed"); case null {} };
      switch (uploadIntents.get(file.id)) {
        case (?intent) { if (UploadJournal.sameDestination(intent.file, file)) return #Ok; return #Err("Upload identity already bound") };
        case null {}
      };
      if (files.any(func f = f.id == file.id or (switch (f.blob_ref) { case (?r) r.canister == ref.canister and r.path == ref.path; case null false })) or uploadIntents.entries().any(func e = switch (e.1.file.blob_ref) { case (?r) r.canister == ref.canister and r.path == ref.path; case null false })) return #Err("Upload path already reserved");
      if (uploadIntents.size() >= 10_000 or uploadIntents.entries().filter(func e = e.1.file.uploaded_by.equal(caller) and not files.any(func f = f.id == e.0)).toArray().size() >= 32) return #Err("Upload recovery capacity reached");
      uploadIntents.add(file.id, { file = { file with created_at_ms = nowMs() }; ready = false }); mediaEvidenceRevision += 1; #Ok
    } finally { removalReceiver.leave(caller) }
  };

  // Only acknowledge after byte finalization AND private access-record/grant acknowledgement.
  public shared ({ caller }) func acknowledge_file_upload(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      auth(caller); await admitAccount(caller);
      let intent = uploadIntents.get(id) ?? return #Err("Upload intent unavailable");
      let f = intent.file; let ref = f.blob_ref ?? return #Err("Upload provenance required");
      if (not f.uploaded_by.equal(caller) or not (await canWrite(caller, f.club, f.team, f.competition_id))) return #Err("Upload owner and current authority required");
      if (not (await verifyFileBytes(caller, ref, f.size))) return #Err("Upload bytes unavailable");
      if (uploadIntents.get(id) != ?intent or deletionIntents.get(id) != null or removalReceiver.denied(caller) or isFenced(f.club)) return #Err("Upload changed");
      uploadIntents.add(id, { intent with ready = true }); #Ok
    } finally { removalReceiver.leave(caller) }
  };

  public shared ({ caller }) func recover_file_upload(id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      auth(caller); await admitAccount(caller);
      let intent = uploadIntents.get(id) ?? return #Err("Upload intent unavailable"); let f = intent.file;
      if (not f.uploaded_by.equal(caller) or not intent.ready) return #Err("Upload outcome unresolved");
      await registerFileAs(caller, f.id, f.folder_id, f.club, f.team, f.name, f.file_url, f.size, f.mime, false, f.blob_ref, f.mini_league_id, f.competition_id)
    } finally { removalReceiver.leave(caller) }
  };

  public shared ({ caller }) func read_my_upload_page(club : Text, after : Text) : async { #Ok : { ids : [Text]; next : ?Text }; #Err : Text } {
    auth(caller); await admitAccount(caller);
    // Empty club scans only the caller's own journal, not club membership/data.
    if (club != "" and not (await currentClubMember(caller, club))) return #Err("Club membership required");
    var scanned = 0; var ids : [Text] = []; var last = after;
    for ((id, intent) in uploadIntents.entriesFrom(after)) {
      if (id == after and after != "") continue;
      if (scanned == 40) return #Ok({ ids; next = ?last });
      scanned += 1; last := id;
      if ((club == "" or intent.file.club == club) and intent.file.uploaded_by.equal(caller) and deletionIntents.get(id) == null and not files.any(func f = f.id == id)) ids := ids.concat([id])
    };
    #Ok({ ids; next = null })
  };

  public shared ({ caller }) func read_my_upload_intent(id : Text) : async { #Ok : UploadJournal.Intent; #Err : Text } {
    auth(caller); await admitAccount(caller);
    let intent = uploadIntents.get(id) ?? return #Err("Upload intent unavailable");
    if (not intent.file.uploaded_by.equal(caller) or deletionIntents.get(id) != null) return #Err("Upload owner required");
    #Ok(intent)
  };

  public shared ({ caller }) func register_file(id : Text, folder_id : Text, club : Text, team : ?Text, name : Text, file_url : Text, size : Nat64, mime : Text, is_external_link : Bool, blob_ref : ?Types.BlobRef, mini_league_id : ?Text, competition_id : ?Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    await registerFileAs(caller, id, folder_id, club, team, name, file_url, size, mime, is_external_link, blob_ref, mini_league_id, competition_id)
  };

  func registerFileAs(caller : Principal,
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not (await canWrite(caller, club, team, competition_id))) return #Err("Club or competition admin required");
    // folder_id "" = vault root (same convention as move_file).
    if (deletionIntents.get(id) != null) return #Err("File identity already removed or cleanup pending");
    switch (uploadIntents.get(id)) {
      case (?intent) {
        let f = intent.file;
        if (not intent.ready or not f.uploaded_by.equal(caller) or f.club != club or f.team != team or f.folder_id != folder_id or f.competition_id != competition_id or f.mini_league_id != mini_league_id or f.blob_ref != blob_ref or f.file_url != file_url or f.name != name or f.mime != mime or f.size != size or is_external_link) return #Err("Upload intent mismatch or unresolved")
      }; case null {
        switch blob_ref { case (?ref) if (uploadIntents.entries().any(func e = switch (e.1.file.blob_ref) { case (?r) r.canister == ref.canister and r.path == ref.path; case null false })) return #Err("Upload path reserved"); case null {} }
      }
    };
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
    var destination : ?Types.VaultFolder = null;
    if (folder_id != "") {
      switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
        case null { return #Err("Folder not found") };
        case (?folder) {
          destination := ?folder;
          if (folder.club != club) return #Err("Folder belongs to another club");
          if (folder.competition_id != competition_id or folder.team != team or folder.mini_league_id != mini_league_id) return #Err("Folder belongs to another vault scope");
          if (competition_id == null and not (await canAccessFolder(caller, folder))) return #Err("Folder access forbidden");
          if (folders.find(func f = f.id == folder_id) != ?folder) return #Err("Folder changed");
        };
      };
    };
    switch (files.find(func f = f.id == id)) {
      case (?f) {
        if (f.uploaded_by.equal(caller) and f.folder_id == folder_id and f.club == club and f.team == team and f.competition_id == competition_id and f.mini_league_id == mini_league_id and f.file_url == file_url and f.size == size and f.mime == mime and f.blob_ref == blob_ref and f.name == name and f.is_external_link == is_external_link and f.deleted_at_ms == null) return #Ok(f);
        return #Err("File id already exists")
      }; case null {}
    };
    if (not is_external_link) {
      let registrationRevision = mediaEvidenceRevision;
      let ref = blob_ref ?? return #Err("Encrypted file provenance required");
      if (not Text.startsWith(ref.path, #text ("clubs/" # club # "/vault/")) or file_url != "https://" # ref.canister # ".raw.icp0.io/" # ref.path) return #Err("Private Vault bytes required");
      if (not (await verifyFileBytes(caller, ref, size))) return #Err("File byte evidence unavailable or mismatched");
      if (not (await canWrite(caller, club, team, competition_id)) or files.any(func f = f.id == id) or mediaEvidenceRevision != registrationRevision or deletionIntents.get(id) != null or isFenced(club)) return #Err("Registration scope changed");
    } else if (blob_ref != null or size != 0 or not Text.startsWith(file_url, #text "https://")) return #Err("Invalid external link");
    switch blob_ref { case (?ref) {
      if (blobCleanupPending(ref)) return #Err("File path cleanup pending")
    }; case null {} };
    switch (uploadIntents.get(id)) {
      case (?intent) if (not intent.ready or not intent.file.uploaded_by.equal(caller) or intent.file.blob_ref != blob_ref or intent.file.folder_id != folder_id) return #Err("Upload changed during registration");
      case null { switch blob_ref { case (?ref) if (uploadIntents.entries().any(func e = switch (e.1.file.blob_ref) { case (?r) r.canister == ref.canister and r.path == ref.path; case null false })) return #Err("Upload path reserved during registration"); case null {} } }
    };
    // No await after this check: a removed/restricted destination cannot admit a late upload.
    if (removalReceiver.denied(caller) or isFenced(club) or deletionIntents.get(id) != null or files.any(func f = f.id == id)) return #Err("Registration scope changed");
    switch destination {
      case (?folder) { if (folder.deleted_at_ms != null or folders.find(func f = f.id == folder_id) != ?folder) return #Err("Registration destination changed") };
      case null { if (folder_id != "") return #Err("Registration destination unavailable") }
    };
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
    mediaEvidenceRevision += 1;
    files := files.concat([file]);
    #Ok(file)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Single-file lookup, same visibility rule as list_files: a file whose
  // folder has restricted_roles is invisible to callers lacking one of
  // those roles. A file with no (deleted) folder is visible like vault root.
  public query ({ caller }) func get_file(id : Text) : async { #Ok : ?Types.VaultFile; #Err : Text } {
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
    auth(caller);
    switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
      case (?folder) {
        if (folder.competition_id != null) return #Ok([]);
      };
      case null {};
    };
    #Ok(files.filter(func(item) = item.folder_id == folder_id and item.deleted_at_ms == null and item.competition_id == null))
  };

  // Folder-joined counterpart of list_files for the vault browser's folder
  // path/name breadcrumbs — same visibility rules as list_files.
  public query ({ caller }) func list_files_with_folder(folder_id : Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
      case (?folder) {
        if (folder.competition_id != null) return #Ok([]);
      };
      case null {};
    };
    #Ok(files.filter(func(item) = item.folder_id == folder_id and item.deleted_at_ms == null and item.competition_id == null).map(withFolderJoin))
  };

  public shared ({ caller }) func list_competition_files_with_folder(folder_id : Text, competition_id : Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
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
          if (not competitionFolderVisible(caller, folder, access)) return #Err("Folder access forbidden");
        };
      };
    };
    #Ok(files.filter(func(file) =
      file.competition_id == ?competition_id and
      file.folder_id == folder_id and
      file.deleted_at_ms == null
    ).map(withFolderJoin))
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_club_files(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(files.filter(func(item) =
      item.club == club and
      item.competition_id == null and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and
      (mini_league_id == null or item.mini_league_id == mini_league_id) and
      (switch (folders.find(func(f) = f.id == item.folder_id)) {
        case null { true };
        case (?folder) { folder.deleted_at_ms == null };
      })))
  };

  // Folder-joined counterpart of list_club_files — same filters/visibility.
  public query ({ caller }) func list_club_files_with_folder(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(files.filter(func(item) =
      item.club == club and
      item.competition_id == null and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and
      (mini_league_id == null or item.mini_league_id == mini_league_id) and
      (switch (folders.find(func(f) = f.id == item.folder_id)) {
        case null { true };
        case (?folder) { folder.deleted_at_ms == null };
      })).map(withFolderJoin))
  };

  public shared ({ caller }) func trash_file(id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (deletionIntents.get(id) != null) return #Err("File cleanup pending");
    if (fileFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        if (file.folder_id != "") {
          let parent = folders.find(func f = f.id == file.folder_id and f.deleted_at_ms == null) ?? return #Err("Folder unavailable");
          if (file.competition_id == null and not (await canAccessFolder(caller, parent))) return #Err("Folder access forbidden");
        };
        if (fileFenced(id) or files.find(func(f) = f.id == id) != ?file) return #Err("File changed during authorization");
        let updated : Types.VaultFile = { file with deleted_at_ms = ?nowMs(); deleted_by = ?caller };
        mediaEvidenceRevision += 1;
        files := files.map(func(item) = if (item.id == id) { updated } else { item });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func restore_file(id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (deletionIntents.get(id) != null) return #Err("File cleanup pending");
    if (fileFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms != null)) {
      case null { #Err("Trashed file not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        if (file.folder_id != "") {
          let parent = folders.find(func f = f.id == file.folder_id and f.deleted_at_ms == null) ?? return #Err("Folder unavailable");
          if (file.competition_id == null and not (await canAccessFolder(caller, parent))) return #Err("Folder access forbidden");
        };
        if (fileFenced(id) or files.find(func(f) = f.id == id) != ?file) return #Err("File changed during authorization");
        if (not file.is_external_link) {
          let ref = file.blob_ref ?? return #Err("File provenance unavailable");
          let store : actor { get_content_hash : shared query (Text) -> async ?Text } = actor(ref.canister);
          if ((await (with timeout = 10) store.get_content_hash(ref.path)) != ?ref.content_hash) return #Err("File bytes unavailable");
          if (not (await canWrite(caller, file.club, file.team, file.competition_id)) or files.find(func f = f.id == id) != ?file) return #Err("Restore scope changed");
        };
        let updated : Types.VaultFile = { file with deleted_at_ms = null; deleted_by = null };
        mediaEvidenceRevision += 1;
        files := files.map(func(item) = if (item.id == id) { updated } else { item });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func rename_file(id : Text, name : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (deletionIntents.get(id) != null) return #Err("File cleanup pending");
    if (fileFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validLong(name, 160)) return #Err("Invalid file name");
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        if (file.folder_id != "") {
          let parent = folders.find(func f = f.id == file.folder_id and f.deleted_at_ms == null) ?? return #Err("Folder unavailable");
          if (file.competition_id == null and not (await canAccessFolder(caller, parent))) return #Err("Folder access forbidden");
        };
        if (fileFenced(id) or files.find(func(f) = f.id == id) != ?file) return #Err("File changed during authorization");
        let updated : Types.VaultFile = { file with name = name };
        mediaEvidenceRevision += 1;
        files := files.map(func(item) = if (item.id == id) { updated } else { item });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Moves a file into another folder of the same club and adopts that
  // folder's team scope. An empty folder_id moves the file to the vault
  // root (no folder) and leaves its team scope unchanged — provisional
  // until the vault scope model is verified post-deploy.
  public shared ({ caller }) func move_file(id : Text, folder_id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (fileFenced(id) or folderFenced(folder_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        if (file.folder_id != "") {
          let parent = folders.find(func f = f.id == file.folder_id and f.deleted_at_ms == null) ?? return #Err("Folder unavailable");
          if (file.competition_id == null and not (await canAccessFolder(caller, parent))) return #Err("Folder access forbidden");
        };
        if (fileFenced(id) or files.find(func(f) = f.id == id) != ?file) return #Err("File changed during authorization");
        if (folder_id == "") {
          let updated : Types.VaultFile = { file with folder_id = "" };
          mediaEvidenceRevision += 1;
          files := files.map(func(item) = if (item.id == id) { updated } else { item });
          return #Ok(updated);
        };
        if (not valid(folder_id)) return #Err("Invalid folder");
        switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
          case null { #Err("Target folder not found") };
          case (?folder) {
            if (folder.club != file.club) return #Err("Target folder belongs to another club");
            if (folder.competition_id != file.competition_id) return #Err("Target folder belongs to another vault scope");
            if (not (await canWrite(caller, folder.club, folder.team, folder.competition_id))) return #Err("Destination authority required");
            if (folder.competition_id == null and not (await canAccessFolder(caller, folder))) return #Err("Destination folder access forbidden");
            if (files.find(func f = f.id == id) != ?file or folders.find(func f = f.id == folder_id) != ?folder or isFenced(file.club)) return #Err("Move scope changed");
            let updated : Types.VaultFile = { file with folder_id = folder_id; team = folder.team; mini_league_id = folder.mini_league_id };
            mediaEvidenceRevision += 1;
            files := files.map(func(item) = if (item.id == id) { updated } else { item });
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func move_file_to_root(id : Text, team : ?Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller); auth(caller);
      let f = files.find(func f = f.id == id and f.deleted_at_ms == null) ?? return #Err("File not found");
      if (deletionIntents.get(id) != null) return #Err("Cleanup pending");
      if (f.competition_id != null or f.mini_league_id != null) return #Err("Use the existing competition or league root");
      if (not (await canWrite(caller, f.club, f.team, null)) or not (await canWrite(caller, f.club, team, null))) return #Err("Source and destination staff required");
      if (f.folder_id != "") { let parent = folders.find(func p = p.id == f.folder_id) ?? return #Err("Folder unavailable"); if (not (await canAccessFolder(caller, parent))) return #Err("Folder access forbidden") };
      switch team { case (?teamId) {
        let cid = club_domain_canister ?? return #Err("Club authority required");
        let service : actor { get_team : shared query (Text) -> async { #Ok : ?{ club_id : Text }; #Err : Text } } = actor(cid.toText());
        switch (await (with timeout = 10) service.get_team(teamId)) { case (#Ok(?t)) { if (t.club_id != f.club) return #Err("Foreign team") }; case (_) return #Err("Team unavailable") };
        if (club_domain_canister != ?cid) return #Err("Authority changed")
      }; case null {} };
      if (not (await canWrite(caller, f.club, f.team, null)) or not (await canWrite(caller, f.club, team, null)) or files.find(func x = x.id == id) != ?f or isFenced(f.club)) return #Err("Move authorization changed");
      let updated = { f with folder_id = ""; team };
      files := files.map(func x = if (x.id == id) updated else x); mediaEvidenceRevision += 1; #Ok(updated)
    } finally { removalReceiver.leave(caller) }
  };

  // Metadata finalization requires byte absence; unknown cleanup keeps the row and intent.
  public shared ({ caller }) func begin_file_cleanup(id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
    await admitAccount(caller); auth(caller);
    let f = files.find(func row = row.id == id) ?? return #Err("File not found");
    if (not (await canWrite(caller, f.club, f.team, f.competition_id))) return #Err("Scoped staff required");
    if (files.find(func row = row.id == id) != ?f or isFenced(f.club)) return #Err("File changed");
    let ref = f.blob_ref ?? return #Err("File provenance unavailable");
    if (files.any(func other = other.id != id and other.blob_ref == f.blob_ref)) return #Err("Shared file bytes require reference reconciliation");
    if (not vaultStores.any(func id = id.toText() == ref.canister)) return #Err("Original store not configured");
    switch (deletionIntents.get(id)) {
      case (?hash) {
        if (hash != ref.content_hash or f.deleted_at_ms == null) return #Err("Cleanup identity changed");
        cleanupRecords.add(id, { club = f.club; team = f.team; competition = f.competition_id; blob_ref = ref; state = #pending });
        return #Ok(f)
      };
      case null {}
    };
    deletionIntents.add(id, ref.content_hash);
    cleanupRecords.add(id, { club = f.club; team = f.team; competition = f.competition_id; blob_ref = ref; state = #pending });
    let hidden = { f with deleted_at_ms = ?nowMs(); deleted_by = ?caller };
    files := files.map(func row = if (row.id == id) hidden else row); mediaEvidenceRevision += 1;
    #Ok(hidden)
    } finally { removalReceiver.leave(caller) }
  };

  // Resume only a previously acknowledged intent; never delete by a browser-supplied path.
  public shared ({ caller }) func resume_file_cleanup(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller); auth(caller);
      let f = switch (files.find(func row = row.id == id)) {
        case (?row) row;
        case null {
          let receipt = cleanupRecords.get(id) ?? return #Err("File not found");
          if (receipt.state != #complete or not (await canWrite(caller, receipt.club, receipt.team, receipt.competition))) return #Err("Scoped completed cleanup required");
          if (cleanupRecords.get(id) != ?receipt or isFenced(receipt.club) or removalReceiver.denied(caller)) return #Err("Cleanup scope changed");
          return #Ok
        }
      };
      let ref = f.blob_ref ?? return #Err("File provenance unavailable");
      if (deletionIntents.get(id) != ?ref.content_hash or f.deleted_at_ms == null) return #Err("File cleanup required");
      if (not (await canWrite(caller, f.club, f.team, f.competition_id))) return #Err("Scoped staff required");
      let pinned = vaultStores;
      if (not pinned.any(func store = store.toText() == ref.canister) or files.find(func row = row.id == id) != ?f or isFenced(f.club) or removalReceiver.denied(caller)) return #Err("Cleanup scope changed");
      if (files.any(func other = other.id != id and other.blob_ref == f.blob_ref)) return #Err("Shared file bytes require reference reconciliation");
      let store : actor { delete_vault_blob : shared (Principal, Text, Text) -> async { #Ok; #Err : Text } } = actor(ref.canister);
      let result = try { await (with timeout = 10) store.delete_vault_blob(caller, ref.path, ref.content_hash) } catch (_) { return #Err("Cleanup outcome unknown; reconcile same file") };
      switch result { case (#Err(e)) return #Err(e); case (#Ok) {} };
      await admitAccount(caller);
      if (not (await canWrite(caller, f.club, f.team, f.competition_id)) or vaultStores != pinned or files.find(func row = row.id == id) != ?f or deletionIntents.get(id) != ?ref.content_hash or isFenced(f.club) or removalReceiver.denied(caller)) return #Err("Cleanup scope changed");
      // The store's successful acknowledgement includes retained-accounting settlement.
      files := files.filter(func row = row.id != id);
      let sources = gallerySourceFiles.entries().filter(func entry = entry.1 == id).toArray();
      for ((source, _) in sources.values()) gallerySourceFiles.remove(source);
      pinned_vaults := pinned_vaults.filter(func pin = pin.vault_file_id != ?id);
      deletionIntents.add(id, "removed:" # ref.content_hash); mediaEvidenceRevision += 1;
      cleanupRecords.add(id, { club = f.club; team = f.team; competition = f.competition_id; blob_ref = ref; state = #complete });
      #Ok
    } finally { removalReceiver.leave(caller) }
  };
  // Erased metadata retains only the original cleanup provenance, never file names.
  // Reads are bounded and governor-only; they do not authorize generic orphan deletion.
  public shared ({ caller }) func read_cleanup_page(after : Text) : async { #Ok : { items : [(Text, CleanupRecord)]; next : ?Text }; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    var items : [(Text, CleanupRecord)] = [];
    for ((id, record) in cleanupRecords.entriesFrom(after)) {
      if (id == after and after != "") continue;
      if (items.size() == 40) return #Ok({ items; next = ?items[39].0 });
      items := items.concat([(id, record)])
    };
    #Ok({ items; next = null })
  };
  public shared ({ caller }) func reconcile_erased_file(id : Text) : async { #Ok; #Err : Text } {
    await reconcileErasedAs(caller, id)
  };
  func reconcileErasedAs(caller : Principal, id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    let record = cleanupRecords.get(id) ?? return #Err("Cleanup record unavailable");
    if (record.state == #complete) return #Ok;
    if (record.state != #erased) return #Err("Erased cleanup required");
    let ref = record.blob_ref;
    let pinned = vaultStores;
    if (not pinned.any(func store = store.toText() == ref.canister) or isFenced(record.club)) return #Err("Cleanup authority unavailable");
    if (files.any(func file = switch (file.blob_ref) { case (?other) other.canister == ref.canister and other.path == ref.path; case null false })) return #Err("Shared file bytes remain referenced");
    let store : actor { delete_vault_blob : shared (Principal, Text, Text) -> async { #Ok; #Err : Text } } = actor(ref.canister);
    let result = try { await (with timeout = 10) store.delete_vault_blob(caller, ref.path, ref.content_hash) } catch (_) { return #Err("Erased cleanup outcome unknown") };
    switch result { case (#Err(e)) return #Err(e); case (#Ok) {} };
    if (not isGovernor(caller) or vaultStores != pinned or cleanupRecords.get(id) != ?record or isFenced(record.club)) return #Err("Cleanup authority changed");
    cleanupRecords.add(id, { record with state = #complete }); mediaEvidenceRevision += 1; #Ok
  };

  // Bounded automatic retention runs entirely on-chain. A successful store reply
  // proves exact expired-byte cleanup; unknown outcomes retain intent/provenance.
  func sweepVaultLifecycle() : async () {
    if (lifecycleRunning) return;
    lifecycleRunning := true;
    try {
      let start = if (lifecycleFileCursor < files.size()) lifecycleFileCursor else 0;
      let end = Nat.min(files.size(), start + 20);
      let candidates = Array.tabulate<Types.VaultFile>(end - start, func i = files[start + i]);
      lifecycleFileCursor := if (end < files.size()) end else 0;
      for (f in candidates.values()) {
        if (f.is_external_link or isFenced(f.club)) continue;
        let ref = switch (f.blob_ref) { case (?r) r; case null continue };
        let cid = switch club_domain_canister { case (?id) id; case null continue };
        let cd : actor { get_media_allowance : shared query (Text, ?Text) -> async { #Ok : { premium : Bool }; #Err : Text }; read_vault_erasure_scope : shared query (Text, ?Text) -> async Bool } = actor(cid.toText());
        let erased = try { await (with timeout = 10) cd.read_vault_erasure_scope(f.club, f.team) } catch (_) { false };
        if (not erased) {
          if (nowMs() <= f.created_at_ms or nowMs() - f.created_at_ms <= 15_552_000_000) continue;
          let allowance = try { await (with timeout = 10) cd.get_media_allowance(f.club, f.team) } catch (_) { continue };
          switch allowance { case (#Ok(a)) if (a.premium) continue; case (#Err(_)) continue }
        };
        if (club_domain_canister != ?cid or isFenced(f.club) or not vaultStores.any(func s = s.toText() == ref.canister) or files.find(func row = row.id == f.id) != ?f or files.any(func other = other.id != f.id and (switch (other.blob_ref) { case (?r) r.canister == ref.canister and r.path == ref.path; case null false }))) continue;
        // Persist the path lock before the remote delete. Do not hide a paid file
        // merely because allowance/transport checks fail.
        switch (deletionIntents.get(f.id)) { case (?hash) if (hash != ref.content_hash) continue; case null deletionIntents.add(f.id, ref.content_hash) };
        cleanupRecords.add(f.id, { club = f.club; team = f.team; competition = f.competition_id; blob_ref = ref; state = #pending });
        let pinned = vaultStores;
        let store : actor { delete_expired_vault_blob : shared (Text, Text) -> async { #Ok; #Err : Text }; delete_erased_scope_vault_blob : shared (Text, Text) -> async { #Ok; #Err : Text } } = actor(ref.canister);
        let result = try { if (erased) await (with timeout = 10) store.delete_erased_scope_vault_blob(ref.path, ref.content_hash) else await (with timeout = 10) store.delete_expired_vault_blob(ref.path, ref.content_hash) } catch (_) { continue };
        switch result { case (#Err(_)) continue; case (#Ok) {} };
        if (vaultStores != pinned or isFenced(f.club) or files.find(func row = row.id == f.id) != ?f or deletionIntents.get(f.id) != ?ref.content_hash) continue;
        files := files.filter(func row = row.id != f.id);
        backups := backups.map(func b = { b with files = b.files.filter(func row = row.id != f.id) });
        pinned_vaults := pinned_vaults.filter(func pin = pin.vault_file_id != ?f.id);
        let sources = gallerySourceFiles.entries().filter(func e = e.1 == f.id).toArray();
        for ((source, _) in sources.values()) gallerySourceFiles.remove(source);
        cleanupRecords.add(f.id, { club = f.club; team = f.team; competition = f.competition_id; blob_ref = ref; state = #complete });
        deletionIntents.add(f.id, "removed:" # ref.content_hash); mediaEvidenceRevision += 1
      };
      var page : [(Text, CleanupRecord)] = [];
      for ((id, record) in cleanupRecords.entriesFrom(lifecycleCleanupCursor)) {
        if (id == lifecycleCleanupCursor and lifecycleCleanupCursor != "") continue;
        if (page.size() == 20) break;
        page := page.concat([(id, record)])
      };
      lifecycleCleanupCursor := if (page.size() == 20) page[19].0 else "";
      for ((id, record) in page.values()) { if (record.state == #erased) { ignore await reconcileErasedAs(governor, id) } };
      // Empty folders need their own bounded scan: a scope with no files never
      // reaches the byte-cleanup loop. Absence or soft deletion is not evidence.
      let folderStart = if (lifecycleFolderCursor < folders.size()) lifecycleFolderCursor else 0;
      let folderEnd = Nat.min(folders.size(), folderStart + 20);
      let folderCandidates = Array.tabulate<Types.VaultFolder>(folderEnd - folderStart, func i = folders[folderStart + i]);
      lifecycleFolderCursor := if (folderEnd < folders.size()) folderEnd else 0;
      for (folder in folderCandidates.values()) {
        if (isFenced(folder.club)) continue;
        let cid = switch club_domain_canister { case (?id) id; case null continue };
        let cd : actor { read_vault_erasure_scope : shared query (Text, ?Text) -> async Bool } = actor(cid.toText());
        let erased = try { await (with timeout = 10) cd.read_vault_erasure_scope(folder.club, folder.team) } catch (_) { continue };
        if (not erased or club_domain_canister != ?cid or isFenced(folder.club) or folders.find(func f = f.id == folder.id) != ?folder) continue;
        // Keep hierarchy while any live/uncertain upload or child still needs it.
        if (files.any(func f = f.folder_id == folder.id) or folders.any(func f = f.parent_id == ?folder.id) or uploadIntents.entries().any(func e = e.1.file.folder_id == folder.id and deletionIntents.get(e.0) == null and not files.any(func f = f.id == e.0))) continue;
        folders := folders.filter(func f = f.id != folder.id);
        backups := backups.map(func b = { b with folders = b.folders.filter(func f = f.id != folder.id) });
        pinned_vaults := pinned_vaults.filter(func p = p.vault_folder_id != ?folder.id);
        mediaEvidenceRevision += 1
      }
    } finally { lifecycleRunning := false }
  };
  transient let _lifecycleTimer = Timer.recurringTimer<system>(#seconds(900), sweepVaultLifecycle);
  public shared ({ caller }) func sweep_vault_lifecycle() : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    await sweepVaultLifecycle(); #Ok
  };
  public shared ({ caller }) func delete_file_permanent(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller); auth(caller);
      let f = files.find(func row = row.id == id) ?? return #Err("File not found");
      if (not (await canWrite(caller, f.club, f.team, f.competition_id))) return #Err("Scoped staff required");
      if (not f.is_external_link) {
        return #Err("Use acknowledged Vault cleanup; byte absence alone is insufficient");
      };
      if (not (await canWrite(caller, f.club, f.team, f.competition_id)) or files.find(func row = row.id == id) != ?f or isFenced(f.club)) return #Err("Cleanup scope changed");
      files := files.filter(func row = row.id != id);
      let sources = gallerySourceFiles.entries().filter(func entry = entry.1 == id).toArray();
      for ((source, _) in sources.values()) gallerySourceFiles.remove(source);
      deletionIntents.add(id, "removed:" # (f.blob_ref.map(func ref = ref.content_hash) ?? "external")); mediaEvidenceRevision += 1; #Ok
    } finally { removalReceiver.leave(caller) }
  };

  public query ({ caller }) func list_trashed_files(club : Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(files.filter(func(item) = item.club == club and item.deleted_at_ms != null and item.competition_id == null))
  };

  // Folder-joined counterpart of list_trashed_files, for the trash view's
  // "was in <folder>" breadcrumb.
  public query ({ caller }) func list_trashed_files_with_folder(club : Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(files.filter(func(item) = item.club == club and item.deleted_at_ms != null and item.competition_id == null).map(withFolderJoin))
  };

  // Pinned vault per chat (Supabase chat_pinned_vault counterpart). Keyed by
  // (chat_type, chat_id); one pin per chat. Writes need a club role, reads
  // any authenticated caller — same trust model as the rest of this canister.
  func validChatType(value : Text) : Bool {
    value == "team" or value == "club" or value == "group"
  };

  type ChatAccess = { club : Text; team : ?Text; can_manage : Bool };
  func chatAccess(subject : Principal, chatType : Text, chatId : Text) : async ?ChatAccess {
    let id = messagingDomainCanister ?? return null;
    let service : actor { read_vault_chat_access : shared (Principal, Text, Text) -> async { #Ok : ChatAccess; #Err : Text } } = actor(id.toText());
    let response = try { await (with timeout = 10) service.read_vault_chat_access(subject, chatType, chatId) } catch (_) { return null };
    await admitAccount(subject);
    if (messagingDomainCanister != ?id) return null;
    switch response { case (#Ok(a)) ?a; case (#Err(_)) null }
  };
  public shared ({ caller }) func set_messaging_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or id.equal(Principal.anonymous())) return #Err("Governor required");
    messagingDomainCanister := ?id; #Ok
  };
  func pinTargetVisible(user : Principal, pin : Types.PinnedVault, access : ChatAccess) : async Bool {
    if (pin.club != access.club) return false;
    if (pin.root_scope == ?"club") return pin.root_id == ?access.club;
    if (pin.root_scope == ?"team") return pin.root_id == access.team and access.team != null;
    switch (pin.vault_folder_id) { case (?id) {
      let f = folders.find(func f = f.id == id and f.club == access.club and f.deleted_at_ms == null) ?? return false;
      return await accountFolderAccess(user, f)
    }; case null {} };
    switch (pin.vault_file_id) { case (?id) {
      let f = files.find(func f = f.id == id and f.club == access.club and f.deleted_at_ms == null) ?? return false;
      return await accountFileAccess(user, f)
    }; case null false }
  };

  public shared ({ caller }) func set_pinned_vault(
    chat_type : Text,
    chat_id : Text,
    club : Text,
    vault_file_id : ?Text,
    vault_folder_id : ?Text,
    root_scope : ?Text,
    root_id : ?Text,
    enabled : Bool,
  ) : async { #Ok : Types.PinnedVault; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let conversationAccess = await chatAccess(caller, chat_type, chat_id);
    let access = conversationAccess ?? return #Err("Conversation access unavailable");
    if (access.club != club or not access.can_manage) return #Err("Conversation manager required");
    if (not validChatType(chat_type)) return #Err("Invalid chat type");
    if (not valid(chat_id) or not valid(club)) return #Err("Invalid pin fields");
    switch (root_scope) {
      case (?scope) { if (scope != "team" and scope != "club") return #Err("Invalid root scope") };
      case null {};
    };
    let targetCount = (if (vault_file_id != null) 1 else 0) + (if (vault_folder_id != null) 1 else 0) + (if (root_id != null) 1 else 0);
    if (targetCount != 1 or (root_id != null and root_scope == null) or (root_id == null and root_scope != null)) return #Err("Exactly one pin target required");
    if (vault_file_id == null and vault_folder_id == null and root_id == null) {
      return #Err("Nothing to pin");
    };
    switch (pinned_vaults.find(func(p) = p.chat_type == chat_type and p.chat_id == chat_id)) {
      case (?existing) { if (not PinScope.sameClub(?existing.club, club)) return #Err("Cannot change a chat's club scope") };
      case null {};
    };
    switch (vault_file_id) {
      case (?id) {
        let target = files.find(func(f) = f.id == id);
        let scope = switch (target) { case null { null }; case (?f) { ?(f.club, f.deleted_at_ms != null) } };
        if (not PinScope.targetClub(scope, club)) return #Err("File is not in the pinned club");
      };
      case null {};
    };
    switch (vault_folder_id) {
      case (?id) {
        let target = folders.find(func(f) = f.id == id);
        let scope = switch (target) { case null { null }; case (?f) { ?(f.club, f.deleted_at_ms != null) } };
        if (not PinScope.targetClub(scope, club)) return #Err("Folder is not in the pinned club");
      };
      case null {};
    };
    if (root_scope == ?"club" and root_id != ?club) return #Err("Root is not in the pinned club");
    if (not (await canWrite(caller, club, null, null))) return #Err("Club role required");
    // Another writer may have created the pin while permission was checked.
    switch (pinned_vaults.find(func(p) = p.chat_type == chat_type and p.chat_id == chat_id)) {
      case (?existing) { if (not PinScope.sameClub(?existing.club, club)) return #Err("Cannot change a chat's club scope") };
      case null {};
    };
    let pin : Types.PinnedVault = {
      chat_type; chat_id; club; vault_file_id; vault_folder_id; root_scope; root_id;
      enabled; set_by = caller; updated_at_ms = nowMs();
    };
    if (not (await pinTargetVisible(caller, pin, access))) return #Err("Pin target access forbidden");
    let freshAccess = (await chatAccess(caller, chat_type, chat_id)) ?? return #Err("Conversation access changed");
    if (freshAccess != access or isFenced(club)) return #Err("Conversation access changed");
    pinned_vaults := pinned_vaults.filter(func(item) = not (item.chat_type == chat_type and item.chat_id == chat_id)).concat([pin]);
    #Ok(pin)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_pinned_vault(chat_type : Text, chat_id : Text) : async { #Ok : ?Types.PinnedVault; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(pinned_vaults.find(func(item) = item.chat_type == chat_type and item.chat_id == chat_id))
  };

  public shared ({ caller }) func clear_pinned_vault(chat_type : Text, chat_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pinned_vaults.find(func(item) = item.chat_type == chat_type and item.chat_id == chat_id)) {
      case null { #Ok };
      case (?pin) {
        let access = (await chatAccess(caller, chat_type, chat_id)) ?? return #Err("Conversation access unavailable");
        if (not access.can_manage or access.club != pin.club or pinned_vaults.find(func p = p.chat_type == chat_type and p.chat_id == chat_id) != ?pin or isFenced(pin.club)) return #Err("Conversation manager required");
        pinned_vaults := pinned_vaults.filter(func(item) = not (item.chat_type == chat_type and item.chat_id == chat_id));
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---------- On-chain vault backups (governor/app-admin only) ----------
  // Snapshots the current folder/file metadata rows into a named backup.
  // Blob refs only — no file bytes, no PII plaintext, no decryption; this
  // mirrors the Supabase `vault-backup` edge function's manifest but keeps
  // everything on-chain. Snapshots every club's folders/files (including
  // trashed rows) since this is a platform-wide admin tool, not a club one.
  func freshBackupId() : Text {
    let id = "backup-" # Nat64.toText(nowMs()) # "-" # Nat64.toText(nextBackupSeq);
    nextBackupSeq += 1;
    id
  };

  public shared ({ caller }) func create_backup(backup_label : Text) : async { #Ok : Types.Backup; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAppAdmin(caller)) return #Err("App admin required");
    if (not validLong(backup_label, 160)) return #Err("Invalid backup label");
    let backup : Types.Backup = {
      id = freshBackupId();
      backup_label = backup_label;
      created_at_ms = nowMs();
      created_by = caller;
      folders;
      files;
    };
    backups := backups.concat([backup]);
    #Ok(backup)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Snapshot arrays are immutable generations; creation returns counts, not an unbounded payload.
  public shared ({ caller }) func create_backup_summary(backup_label : Text) : async { #Ok : Types.BackupSummary; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller); auth(caller);
      if (not isAppAdmin(caller)) return #Err("App admin required");
      if (not validLong(backup_label, 160)) return #Err("Invalid backup label");
      let backup : Types.Backup = { id = freshBackupId(); backup_label; created_at_ms = nowMs(); created_by = caller; folders; files };
      backups := backups.concat([backup]);
      #Ok(BackupPages.summary(backup))
    } finally { removalReceiver.leave(caller) }
  };

  public shared ({ caller }) func read_backup_page(id : Text, offset : Nat, expected : ?Nat) : async { #Ok : Types.BackupPage; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller); auth(caller);
      if (not isAppAdmin(caller)) return #Err("App admin required");
      switch expected { case (?r) { if (r != mediaEvidenceRevision) return #Err("Backup export revision changed") }; case null { if (offset != 0) return #Err("Backup revision required") } };
      let backup = backups.find(func b = b.id == id) ?? return #Err("Backup not found");
      if (offset > backup.folders.size() + backup.files.size()) return #Err("Invalid backup cursor");
      #Ok(BackupPages.page(backup, offset, mediaEvidenceRevision))
    } finally { removalReceiver.leave(caller) }
  };

  public query ({ caller }) func list_backups() : async { #Ok : [Types.BackupSummary]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isAppAdmin(caller)) return #Err("App admin required");
    #Ok(backups.map(func(b : Types.Backup) : Types.BackupSummary {
      { id = b.id; backup_label = b.backup_label; created_at_ms = b.created_at_ms; created_by = b.created_by;
        folder_count = b.folders.size(); file_count = b.files.size() }
    }))
  };

  // Full snapshot (every folder/file row in the backup) for the download/export
  // button — the frontend serializes this to a JSON file client-side.
  public query ({ caller }) func get_backup(id : Text) : async { #Ok : Types.Backup; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isAppAdmin(caller)) return #Err("App admin required");
    switch (backups.find(func(b : Types.Backup) : Bool = b.id == id)) {
      case null { #Err("Backup not found") };
      case (?backup) { #Ok(backup) };
    }
  };

  // Re-inserts metadata rows from the backup that are missing from the live
  // tables (matched by id) — never overwrites an existing row, so a restore
  // can't clobber newer edits made after the snapshot was taken. Returns the
  // number of folders/files actually re-inserted.
  public shared ({ caller }) func restore_backup(id : Text) : async { #Ok : Nat; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (transferFences.size() > 0) return #Err("Restore is blocked while a club transfer is in progress");
    auth(caller);
    if (not isAppAdmin(caller)) return #Err("App admin required");
    switch (backups.find(func(b : Types.Backup) : Bool = b.id == id)) {
      case null { #Err("Backup not found") };
      case (?backup) {
        if (backup.folders.size() + backup.files.size() > 200) return #Err("Use bounded backup restore pages");
        var restored = 0;
        for (f in backup.folders.values()) {
          if (f.deleted_at_ms == null and not folders.any(func row = row.id == f.id) and
            (f.parent_id == null or folders.any(func p = ?p.id == f.parent_id and p.deleted_at_ms == null and p.club == f.club and p.competition_id == f.competition_id))) {
            if (not (await canWrite(caller, f.club, f.team, f.competition_id))) return #Err("Restore authority unavailable");
            if (not folders.any(func row = row.id == f.id) and not isFenced(f.club)) { folders := folders.concat([f]); restored += 1; mediaEvidenceRevision += 1 }
          }
        };
        for (f in backup.files.values()) {
          if (f.deleted_at_ms == null and deletionIntents.get(f.id) == null and not files.any(func row = row.id == f.id)) {
            let available = if (f.is_external_link) true else switch (f.blob_ref) { case (?ref) await verifyFileBytes(caller, ref, f.size); case null false };
            if (available and (await canWrite(caller, f.club, f.team, f.competition_id)) and not files.any(func row = row.id == f.id) and deletionIntents.get(f.id) == null and not isFenced(f.club) and
              (f.folder_id == "" or folders.any(func p = p.id == f.folder_id and p.deleted_at_ms == null and p.club == f.club and p.team == f.team and p.competition_id == f.competition_id and p.mini_league_id == f.mini_league_id))) {
              files := files.concat([f]); restored += 1; mediaEvidenceRevision += 1
            }
          }
        };
        #Ok(restored)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Each acknowledged cursor is durable before another external await.
  // Repeated/older pages read the receipt; they never repeat completed writes.
  public shared ({ caller }) func restore_backup_page(id : Text, offset : Nat) : async { #Ok : { next : Nat; restored : Nat; skipped : Nat; complete : Bool }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    let key = caller.toText() # ":" # id;
    try {
      await admitAccount(caller); auth(caller);
      if (not isAppAdmin(caller)) return #Err("App admin required");
      if (transferFences.size() > 0) return #Err("Restore is blocked while a club transfer is in progress");
      let backup = backups.find(func b = b.id == id) ?? return #Err("Backup not found");
      if (backupRestoreLocks.get(key) != null) return #Err("Backup restore already in progress");
      let progress = backupRestoreProgress.get(key) ?? ({ next = 0; restored = 0; skipped = 0; complete = false });
      if (offset > progress.next) return #Err("Restore cursor not acknowledged");
      if (offset < progress.next or progress.complete) return #Ok(progress);
      backupRestoreLocks.add(key, true);
      try {
        var next = progress.next; var restored = progress.restored; var skipped = progress.skipped;
        let total = backup.folders.size() + backup.files.size();
        let end = Nat.min(total, next + 40);
        while (next < end) {
          let rowRevision = mediaEvidenceRevision;
          var inserted = false;
          if (next < backup.folders.size()) {
            let f = backup.folders[next];
            if (f.deleted_at_ms == null and not folders.any(func row = row.id == f.id)) {
              let allowed = await canWrite(caller, f.club, f.team, f.competition_id);
              let parentAllowed = switch (f.parent_id) {
                case null true;
                case (?parentId) switch (folders.find(func p = p.id == parentId)) {
                  case null false;
                  case (?parent) parent.club == f.club and parent.team == f.team and parent.mini_league_id == f.mini_league_id and parent.competition_id == f.competition_id and (await canAccessFolder(caller, parent))
                }
              };
              await admitAccount(caller);
              if (mediaEvidenceRevision != rowRevision) return #Err("Vault changed during restore; resume from acknowledged cursor");
              if (allowed and parentAllowed and isAppAdmin(caller) and transferFences.size() == 0 and not isFenced(f.club) and not folders.any(func row = row.id == f.id) and
                (f.parent_id == null or folders.any(func p = ?p.id == f.parent_id and p.deleted_at_ms == null and p.club == f.club and p.team == f.team and p.competition_id == f.competition_id and p.mini_league_id == f.mini_league_id))) {
                folders := folders.concat([f]); inserted := true; mediaEvidenceRevision += 1
              }
            }
          } else {
            let f = backup.files[next - backup.folders.size()];
            if (f.deleted_at_ms == null and deletionIntents.get(f.id) == null and not files.any(func row = row.id == f.id)) {
              let available = if (f.is_external_link) true else switch (f.blob_ref) { case (?ref) await verifyFileBytes(caller, ref, f.size); case null false };
              let destinationAllowed = if (f.folder_id == "") true else switch (folders.find(func p = p.id == f.folder_id)) {
                case null false;
                case (?parent) parent.club == f.club and parent.team == f.team and parent.mini_league_id == f.mini_league_id and parent.competition_id == f.competition_id and (await canAccessFolder(caller, parent))
              };
              let allowed = await canWrite(caller, f.club, f.team, f.competition_id);
              await admitAccount(caller);
              if (mediaEvidenceRevision != rowRevision) return #Err("Vault changed during restore; resume from acknowledged cursor");
              if (available and destinationAllowed and allowed and isAppAdmin(caller) and transferFences.size() == 0 and not isFenced(f.club) and deletionIntents.get(f.id) == null and not files.any(func row = row.id == f.id) and
                (f.folder_id == "" or folders.any(func p = p.id == f.folder_id and p.deleted_at_ms == null and p.club == f.club and p.team == f.team and p.competition_id == f.competition_id and p.mini_league_id == f.mini_league_id))) {
                files := files.concat([f]); inserted := true; mediaEvidenceRevision += 1
              }
            }
          };
          next += 1;
          if (inserted) restored += 1 else skipped += 1;
          backupRestoreProgress.add(key, { next; restored; skipped; complete = next == total });
        };
        let receipt = { next; restored; skipped; complete = next == total };
        backupRestoreProgress.add(key, receipt);
        #Ok(receipt)
      } finally { backupRestoreLocks.remove(key) }
    } finally { removalReceiver.leave(caller) }
  };

  public shared ({ caller }) func delete_backup(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAppAdmin(caller)) return #Err("App admin required");
    if (backupRestoreLocks.entries().any(func entry = entry.0.endsWith(#text(":" # id)))) return #Err("Backup restore in progress");
    if (not backups.any(func(b : Types.Backup) : Bool = b.id == id)) return #Err("Backup not found");
    backups := backups.filter(func(b : Types.Backup) : Bool = b.id != id);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Permanently removes the caller's own vault content during account
  // erasure: every file they uploaded (any club/team scope), their backups,
  // and folders they created that are left empty. Encrypted blob bytes in
  // media_blob_store become unreferenced ciphertext; once the matching PII
  // records are erased they are undecryptable by anyone.
  public shared ({ caller }) func purge_my_data() : async { #Ok : Nat32; #Err : Text } {
    auth(caller);
    // Metadata erasure must never be undone by another administrator's backup.
    // Physical-byte cleanup remains separately reconciled, not guessed here.
    for (f in files.values()) {
      if (f.uploaded_by.equal(caller)) {
        deletionIntents.add(f.id, "erased:" # (f.blob_ref.map(func ref = ref.content_hash) ?? "external"));
        switch (f.blob_ref) { case (?ref) cleanupRecords.add(f.id, { club = f.club; team = f.team; competition = f.competition_id; blob_ref = ref; state = #erased }); case null {} }
      }
    };
    let erasedUploads = uploadIntents.entries().filter(func e = e.1.file.uploaded_by.equal(caller)).toArray();
    for ((id, intent) in erasedUploads.values()) {
      deletionIntents.add(id, "erased-upload");
      // Unacknowledged byte/PII outcomes are never automatically deleted.
      if (intent.ready and not files.any(func f = f.id == id)) {
        switch (intent.file.blob_ref) { case (?ref) cleanupRecords.add(id, { club = intent.file.club; team = intent.file.team; competition = intent.file.competition_id; blob_ref = ref; state = #erased }); case null {} }
      };
      uploadIntents.add(id, { intent with file = { intent.file with name = "Erased upload"; folder_id = "" }; ready = false })
    };
    var removed : Nat = 0;
    let keepFiles = files.filter(func(f : Types.VaultFile) : Bool = not f.uploaded_by.equal(caller));
    mediaEvidenceRevision += 1;
    removed += files.size() - keepFiles.size(); files := keepFiles;
    let keepBackups = backups.filter(func(b : Types.Backup) : Bool = not b.created_by.equal(caller));
    removed += backups.size() - keepBackups.size();
    // Other administrators' snapshots must not retain the erased person's metadata.
    backups := keepBackups.map(func b {
      let remaining = b.files.filter(func f = not f.uploaded_by.equal(caller));
      { b with files = remaining; folders = ErasureFolders.scrub(caller, b.folders, remaining) }
    });
    let pendingDestinations = uploadIntents.entries().filter(func e = not e.1.file.uploaded_by.equal(caller) and deletionIntents.get(e.0) == null).map(func e = e.1.file).toArray();
    let keepFolders = ErasureFolders.scrub(caller, folders, files.concat(pendingDestinations));
    removed += folders.size() - keepFolders.size(); folders := keepFolders;
    let keepRoles = roles.filter(func r = not r.user.equal(caller));
    removed += roles.size() - keepRoles.size(); roles := keepRoles;
    let keepPins = pinned_vaults.filter(func p = not p.set_by.equal(caller) and
      (p.vault_file_id == null or files.any(func f = ?f.id == p.vault_file_id)) and
      (p.vault_folder_id == null or folders.any(func f = ?f.id == p.vault_folder_id)));
    removed += pinned_vaults.size() - keepPins.size(); pinned_vaults := keepPins;
    let staleSources = gallerySourceFiles.entries().filter(func entry = not files.any(func f = f.id == entry.1)).toArray();
    for ((source, _) in staleSources.values()) gallerySourceFiles.remove(source);
    #Ok(Nat32.fromNat(removed))
  };

  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  //
  // Covered: RoleGrant.user, VaultFolder.created_by/deleted_by,
  // VaultFile.uploaded_by/deleted_by, PinnedVault.set_by.
  // Not touched: governor (governor variable itself), club_domain_canister
  // (canister wiring).
  public shared ({ caller }) func rekey_principal(old : Principal, new_principal : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #err("Forbidden");
    if (removalReceiver.denied(old) or removalReceiver.denied(new_principal)) return #err("Removed identity cannot be rekeyed or merged");
    if (old.equal(Principal.anonymous()) or new_principal.equal(Principal.anonymous())) return #err("Invalid principal");
    if (old.equal(new_principal)) return #err("old and new principal must differ");
    if (isGovernor(old)) return #err("Cannot rekey the governor");

    func optEq(p : ?Principal, target : Principal) : Bool {
      switch (p) { case (?x) { x.equal(target) }; case null { false } };
    };

    var conflicts = 0;
    conflicts += roles.filter(func(r : Types.RoleGrant) : Bool = r.user.equal(new_principal)).size();
    conflicts += folders.filter(func(f : Types.VaultFolder) : Bool = f.created_by.equal(new_principal) or optEq(f.deleted_by, new_principal)).size();
    conflicts += files.filter(func(f : Types.VaultFile) : Bool = f.uploaded_by.equal(new_principal) or optEq(f.deleted_by, new_principal)).size();
    conflicts += pinned_vaults.filter(func(p : Types.PinnedVault) : Bool = p.set_by.equal(new_principal)).size();
    conflicts += backups.filter(func(b : Types.Backup) : Bool = b.created_by.equal(new_principal)).size();
    conflicts += uploadIntents.entries().filter(func e = e.1.file.uploaded_by.equal(new_principal)).toArray().size();
    if (conflicts > 0) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in vault_domain");

    var changed = 0;

    let newRoles = roles.map(func(r : Types.RoleGrant) : Types.RoleGrant {
      if (r.user.equal(old)) { changed += 1; { r with user = new_principal } } else { r }
    });

    let newFolders = folders.map(func(f : Types.VaultFolder) : Types.VaultFolder {
      var out = f;
      var touched = false;
      if (out.created_by.equal(old)) { out := { out with created_by = new_principal }; touched := true };
      if (optEq(out.deleted_by, old)) { out := { out with deleted_by = ?new_principal }; touched := true };
      if (touched) { changed += 1 };
      out
    });

    let newFiles = files.map(func(f : Types.VaultFile) : Types.VaultFile {
      var out = f;
      var touched = false;
      if (out.uploaded_by.equal(old)) { out := { out with uploaded_by = new_principal }; touched := true };
      if (optEq(out.deleted_by, old)) { out := { out with deleted_by = ?new_principal }; touched := true };
      if (touched) { changed += 1 };
      out
    });

    let newPinned = pinned_vaults.map(func(p : Types.PinnedVault) : Types.PinnedVault {
      if (p.set_by.equal(old)) { changed += 1; { p with set_by = new_principal } } else { p }
    });

    let newBackups = backups.map(func(b : Types.Backup) : Types.Backup {
      if (b.created_by.equal(old)) { changed += 1; { b with created_by = new_principal } } else { b }
    });

    if (not dry_run) {
      roles := newRoles;
      folders := newFolders;
      mediaEvidenceRevision += 1;
      files := newFiles;
      pinned_vaults := newPinned;
      backups := newBackups;
      let entries = uploadIntents.entries().toArray();
      for ((id, intent) in entries.values()) {
        if (intent.file.uploaded_by.equal(old)) { uploadIntents.add(id, { intent with file = { intent.file with uploaded_by = new_principal } }); changed += 1 }
      };
    };

    #ok(changed)
  };
  public shared ({ caller }) func read_club_media_references(club : Text, offset : Nat, expected : ?Nat) : async { #Ok : MediaEvidence.Page; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before media inventory");
    switch (expected) { case (?r) { if (r != mediaEvidenceRevision) return #Err("Media inventory revision changed") }; case null { if (offset != 0) return #Err("Revision required after first page") } };
    let (start, end) = MediaEvidence.bounds(offset, files.size());
    var refs : [MediaEvidence.Reference] = [];
    for (i in Nat.range(start, end)) { let f = files[i]; if (f.club == club) {
      let r = switch (f.blob_ref) { case (?b) { { resource_id = f.id; url = f.file_url; store = ?b.canister; path = ?b.path; content_hash = ?b.content_hash } }; case null { { resource_id = f.id; url = f.file_url; store = null; path = null; content_hash = null } } };
      refs := refs.concat([r]);
    } };
    #Ok({ revision = mediaEvidenceRevision; scanned = end - start; next = if (end < files.size()) ?end else null; references = refs })
  };


  func currentClubMember(caller : Principal, club : Text) : async Bool {
    let authority = club_domain_canister;
    if (isGovernor(caller)) return not isFenced(club);
    let id = switch (authority) { case null return false; case (?id) id };
    let service : actor { read_has_club_membership : shared (Principal, Text) -> async Bool; is_club_member : shared query (Principal, Text) -> async Bool } = actor(id.toText());
    let allowed = try {
      await (with timeout = 10) service.read_has_club_membership(caller, club)
    } catch (_) { false };
    await admitAccount(caller);
    allowed and club_domain_canister == authority and not isFenced(club)
  };
  func accountFolderAccess(caller : Principal, folder : Types.VaultFolder) : async Bool {
    if (not (await currentClubMember(caller, folder.club))) return false;
    await canAccessFolder(caller, folder)
  };
  func accountFileAccess(caller : Principal, file : Types.VaultFile) : async Bool {
    if (not (await currentClubMember(caller, file.club))) return false;
    if (files.find(func(f) = f.id == file.id) != ?file) return false;
    switch (folders.find(func(f) = f.id == file.folder_id)) {
      case null file.folder_id == "";
      case (?folder) folder.club == file.club and folder.team == file.team and folder.mini_league_id == file.mini_league_id and folder.competition_id == file.competition_id and (await canAccessFolder(caller, folder))
    }
  };
  func fileVisible(caller : Principal, file : Types.VaultFile, grants : [(Text, ?Text)]) : Bool {
    if (isFenced(file.club)) return false;
    switch (folders.find(func f = f.id == file.folder_id)) {
      case null file.folder_id == "";
      case (?f) f.club == file.club and f.competition_id == file.competition_id and f.team == file.team and f.mini_league_id == file.mini_league_id and folderVisible(caller, f, grants)
    }
  };
  func accountFiles(caller : Principal, candidates : [Types.VaultFile]) : async [Types.VaultFile] {
    if (candidates.size() > 200) Runtime.trap("Use bounded vault pages");
    var out : [Types.VaultFile] = [];
    var clubs : [Text] = [];
    for (f in candidates.values()) { if (not clubs.any(func c = c == f.club)) clubs := clubs.concat([f.club]) };
    for (club in clubs.values()) {
      if (await currentClubMember(caller, club)) {
        let grants = await currentRoles(caller, club);
        out := out.concat(candidates.filter(func f = f.club == club and files.find(func row = row.id == f.id) == ?f and fileVisible(caller, f, grants)))
      }
    };
    out
  };

  public shared ({ caller }) func read_vault_file_page(club : Text, team : ?Text, league : ?Text, competition : ?Text, folder : ?Text, trash : Bool, offset : Nat, expected : ?Nat) : async { #Ok : { items : [Types.VaultFileWithFolder]; next : ?Nat; revision : Nat }; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller); auth(caller);
      if (offset > files.size()) return #Err("Invalid cursor");
      let access = switch (competition) { case (?id) await getCompetitionAccess(caller, id); case null null };
      switch (competition) {
        case (?_) { switch access { case (?a) { if (not a.is_member or a.club_id != club) return #Err("Competition membership required") }; case null return #Err("Competition access unavailable") } };
        case null { if (not (await currentClubMember(caller, club))) return #Err("Club membership required") }
      };
      let grants = await currentRoles(caller, club);
      let revision = mediaEvidenceRevision;
      switch expected { case (?r) if (r != revision) return #Err("Vault inventory changed"); case null if (offset != 0) return #Err("Revision required") };
      let end = Nat.min(files.size(), offset + 200);
      var items : [Types.VaultFileWithFolder] = [];
      for (i in Nat.range(offset, end)) {
        let f = files[i];
        if (f.club == club and f.competition_id == competition and (team == null or f.team == team or f.team == null) and (league == null or f.mini_league_id == league) and (folder == null or folder == ?f.folder_id) and (f.deleted_at_ms != null) == trash) {
          let permission = switch access {
            case (?a) {
              switch (folders.find(func x = x.id == f.folder_id)) {
                case null f.folder_id == "";
                case (?parent) competitionFolderVisible(caller, parent, a)
              }
            };
            case null fileVisible(caller, f, grants)
          };
          if (permission) items := items.concat([withFolderJoin(f)])
        }
      };
      if (isFenced(club)) return #Err("Club locked");
      #Ok({ items; next = if (end < files.size()) ?end else null; revision })
    } finally { removalReceiver.leave(caller) }
  };

  // Protected consensus reads for the opt-in local account-removal rehearsal.
  public shared ({ caller }) func read_account_list_folders(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFolder]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller); auth(caller);
    if (not (await currentClubMember(caller, club))) return #Err("Club membership required");
    let grants = await currentRoles(caller, club);
    #Ok(folders.filter(func(item) = item.club == club and item.competition_id == null and item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and (mini_league_id == null or item.mini_league_id == mini_league_id) and folderVisible(caller, item, grants)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_folder(id : Text) : async { #Ok : ?Types.VaultFolder; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (folders.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Ok(null) };
      case (?folder) {
        if (folder.competition_id != null) return #Ok(null);
        if (not (await accountFolderAccess(caller, folder))) return #Ok(null);
        #Ok(?folder)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_file(id : Text) : async { #Ok : ?Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller); auth(caller);
    let file = switch (files.find(func(f) = f.id == id and f.deleted_at_ms == null and f.competition_id == null)) { case null return #Ok(null); case (?f) f };
    if (not (await accountFileAccess(caller, file))) return #Ok(null);
    #Ok(?file)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_files(folder_id : Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
      case (?folder) {
        if (folder.competition_id != null) return #Ok([]);
      };
      case null {};
    };
    let visible = await accountFiles(caller, files.filter(func(item) = item.folder_id == folder_id and item.deleted_at_ms == null and item.competition_id == null));
    #Ok(visible)
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func read_account_list_files_with_folder(folder_id : Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (folders.find(func(item) = item.id == folder_id and item.deleted_at_ms == null)) {
      case (?folder) {
        if (folder.competition_id != null) return #Ok([]);
      };
      case null {};
    };
    let visible = await accountFiles(caller, files.filter(func(item) = item.folder_id == folder_id and item.deleted_at_ms == null and item.competition_id == null));
    #Ok(visible.map(withFolderJoin))
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func read_account_list_club_files(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let visible = await accountFiles(caller, files.filter(func(item) =
      item.club == club and
      item.competition_id == null and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and
      (mini_league_id == null or item.mini_league_id == mini_league_id) and
      (switch (folders.find(func(f) = f.id == item.folder_id)) {
        case null { true };
        case (?folder) { folder.deleted_at_ms == null };
      })));
    #Ok(visible)
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func read_account_list_club_files_with_folder(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let visible = await accountFiles(caller, files.filter(func(item) =
      item.club == club and
      item.competition_id == null and
      item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and
      (mini_league_id == null or item.mini_league_id == mini_league_id) and
      (switch (folders.find(func(f) = f.id == item.folder_id)) {
        case null { true };
        case (?folder) { folder.deleted_at_ms == null };
      })));
    #Ok(visible.map(withFolderJoin))
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func read_account_list_trashed_files(club : Text) : async { #Ok : [Types.VaultFile]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let visible = await accountFiles(caller, files.filter(func(item) = item.club == club and item.deleted_at_ms != null and item.competition_id == null));
    #Ok(visible)
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func read_account_list_trashed_files_with_folder(club : Text) : async { #Ok : [Types.VaultFileWithFolder]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let visible = await accountFiles(caller, files.filter(func(item) = item.club == club and item.deleted_at_ms != null and item.competition_id == null));
    #Ok(visible.map(withFolderJoin))
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func read_account_get_pinned_vault(chat_type : Text, chat_id : Text) : async { #Ok : ?Types.PinnedVault; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let access = (await chatAccess(caller, chat_type, chat_id)) ?? return #Err("Conversation access unavailable");
    let pin = pinned_vaults.find(func p = p.chat_type == chat_type and p.chat_id == chat_id) ?? return #Ok(null);
    if (not (await pinTargetVisible(caller, pin, access)) or pinned_vaults.find(func p = p.chat_type == chat_type and p.chat_id == chat_id) != ?pin) return #Ok(null);
    #Ok(?pin)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_backups() : async { #Ok : [Types.BackupSummary]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAppAdmin(caller)) return #Err("App admin required");
    #Ok(backups.map(func(b : Types.Backup) : Types.BackupSummary {
      { id = b.id; backup_label = b.backup_label; created_at_ms = b.created_at_ms; created_by = b.created_by;
        folder_count = b.folders.size(); file_count = b.files.size() }
    }))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_backup(id : Text) : async { #Ok : Types.Backup; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAppAdmin(caller)) return #Err("App admin required");
    switch (backups.find(func(b : Types.Backup) : Bool = b.id == id)) {
      case null { #Err("Backup not found") };
      case (?backup) { #Ok(backup) };
    }
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func prepare_account_removal(request : RemovalReceiver.Request) : async { #Ok; #Err : Text } {
    removalReceiver.prepare(caller, request)
  };
  public shared ({ caller }) func read_account_removal_drain(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    removalReceiver.receipt(caller, request, Principal.fromActor(this), 0)
  };

  public shared ({ caller }) func seal_account_removal(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    removalReceiver.seal(caller, request, Principal.fromActor(this), 0)
  };
}
