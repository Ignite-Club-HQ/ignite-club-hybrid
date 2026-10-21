import AccountAdmission "../../shared/AccountAdmission";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import Error "mo:core/Error";
import MediaEvidence "../../shared/MediaEvidence";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "types";
import PinScope "pinScope";

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
    if (accountAdmissionEnabled) Runtime.trap("Use protected consensus account read");
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
  var roles : [Types.RoleGrant];
  var club_domain_canister : ?Principal;
  var competition_domain_canister : ?Principal;
  var pinned_vaults : [Types.PinnedVault];
  var backups : [Types.Backup];
  var transferFences : [Text];
  var nextBackupSeq : Nat64;

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
    if (isGovernor(caller) or hasRole(caller, club, team)) return true;
    switch (club_domain_canister) {
      case null { false };
      case (?cid) {
        let cd : actor { has_club_staff_role : shared query (Principal, Text) -> async Bool; read_has_club_staff_role : shared (Principal, Text) -> async Bool } = actor (Principal.toText(cid));
        let allowed = try { if (accountAdmissionEnabled) await cd.read_has_club_staff_role(caller, club) else await cd.has_club_staff_role(caller, club) } catch (_) { false };
        await admitAccount(caller);
        allowed and club_domain_canister == ?cid and not isFenced(club)
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
        if (folderFenced(id) or folders.find(func(f) = f.id == id) != ?folder) return #Err("Folder changed during authorization");
        let updated : Types.VaultFolder = { folder with name; restricted_roles; sort_order; description; color };
        folders := folders.map(func(item) = if (item.id == id) { updated } else { item });
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
        if (folderFenced(id) or folders.find(func(f) = f.id == id) != ?folder) return #Err("Folder changed during authorization");
        if (folders.any(func(item) = item.parent_id == ?id and item.deleted_at_ms == null)) return #Err("Folder has subfolders");
        if (files.any(func(item) = item.folder_id == id and item.deleted_at_ms == null)) return #Err("Folder has files");
        let updated : Types.VaultFolder = { folder with deleted_at_ms = ?nowMs(); deleted_by = ?caller };
        folders := folders.map(func(item) = if (item.id == id) { updated } else { item });
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
          switch (folder) { case (?f) if (not canViewFolder(caller, f)) return #Ok(null); case null switch (file) { case (?f) switch (folders.find(func(p) = p.id == f.folder_id)) { case (?p) if (not canViewFolder(caller, p)) return #Ok(null); case null {} }; case null {} } };
        }
      };
    };
    if (isFenced(club)) return #Ok(null);
    if (folder != null and folders.find(func(f) = f.id == id) != folder) return #Ok(null);
    if (file != null and files.find(func(f) = f.id == id) != file) return #Ok(null);
    #Ok(?club)
  
    } finally { removalReceiver.leave(caller) };
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
      (folder.restricted_roles.size() == 0 or access.can_manage)
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
            if (folder.restricted_roles.size() > 0 and not value.can_manage) return #Ok(null);
            #Ok(?folder)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club)) return #Err("Club is temporarily locked for a transfer");
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
        if (folder.competition_id != null or not canViewFolder(caller, folder)) return #Ok([]);
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
        if (folder.competition_id != null or not canViewFolder(caller, folder)) return #Ok([]);
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
          if (folder.restricted_roles.size() > 0 and not access.can_manage) return #Err("Folder access forbidden");
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
        case (?folder) { canViewFolder(caller, folder) };
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
        case (?folder) { canViewFolder(caller, folder) };
      })).map(withFolderJoin))
  };

  public shared ({ caller }) func trash_file(id : Text) : async { #Ok : Types.VaultFile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (fileFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
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
    if (fileFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms != null)) {
      case null { #Err("Trashed file not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        if (fileFenced(id) or files.find(func(f) = f.id == id) != ?file) return #Err("File changed during authorization");
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
    if (fileFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validLong(name, 160)) return #Err("Invalid file name");
    switch (files.find(func(item) = item.id == id and item.deleted_at_ms == null)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
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
            let updated : Types.VaultFile = { file with folder_id = folder_id; team = folder.team };
            mediaEvidenceRevision += 1;
            files := files.map(func(item) = if (item.id == id) { updated } else { item });
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Hard delete — removes the metadata row outright. File bytes live outside
  // this canister (Supabase storage today, the blob store later), so byte
  // cleanup stays with the storage layer.
  public shared ({ caller }) func delete_file_permanent(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (fileFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (files.find(func(item) = item.id == id)) {
      case null { #Err("File not found") };
      case (?file) {
        if (not (await canWrite(caller, file.club, file.team, file.competition_id))) return #Err("Club or competition admin required");
        if (fileFenced(id) or files.find(func(f) = f.id == id) != ?file) return #Err("File changed during authorization");
        mediaEvidenceRevision += 1;
        files := files.filter(func(item) = item.id != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
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
    if (not validChatType(chat_type)) return #Err("Invalid chat type");
    if (not valid(chat_id) or not valid(club)) return #Err("Invalid pin fields");
    switch (root_scope) {
      case (?scope) { if (scope != "team" and scope != "club") return #Err("Invalid root scope") };
      case null {};
    };
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
        if (not (await canWrite(caller, pin.club, null, null))) return #Err("Club role required");
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
        var restored = 0;
        let missingFolders = backup.folders.filter(func(f : Types.VaultFolder) : Bool =
          not folders.any(func(item : Types.VaultFolder) : Bool = item.id == f.id));
        let missingFiles = backup.files.filter(func(f : Types.VaultFile) : Bool =
          not files.any(func(item : Types.VaultFile) : Bool = item.id == f.id));
        restored += missingFolders.size();
        restored += missingFiles.size();
        folders := folders.concat(missingFolders);
        mediaEvidenceRevision += 1;
        files := files.concat(missingFiles);
        #Ok(restored)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_backup(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAppAdmin(caller)) return #Err("App admin required");
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
    var removed : Nat = 0;
    let keepFiles = files.filter(func(f : Types.VaultFile) : Bool = not f.uploaded_by.equal(caller));
    mediaEvidenceRevision += 1;
    removed += files.size() - keepFiles.size(); files := keepFiles;
    let keepBackups = backups.filter(func(b : Types.Backup) : Bool = not b.created_by.equal(caller));
    removed += backups.size() - keepBackups.size(); backups := keepBackups;
    let keepFolders = folders.filter(func(folder : Types.VaultFolder) : Bool =
      not folder.created_by.equal(caller)
      or files.any(func(f : Types.VaultFile) : Bool = f.folder_id == folder.id)
      or folders.any(func(other : Types.VaultFolder) : Bool = other.parent_id == ?folder.id and not other.created_by.equal(caller)));
    removed += folders.size() - keepFolders.size(); folders := keepFolders;
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
      if (accountAdmissionEnabled) await (with timeout = 10) service.read_has_club_membership(caller, club)
      else await (with timeout = 10) service.is_club_member(caller, club)
    } catch (_) { false };
    await admitAccount(caller);
    allowed and club_domain_canister == authority and not isFenced(club)
  };
  func accountFolderAccess(caller : Principal, folder : Types.VaultFolder) : async Bool {
    if (not (await currentClubMember(caller, folder.club))) return false;
    folders.find(func(f) = f.id == folder.id) == ?folder and canViewFolder(caller, folder)
  };
  func accountFileAccess(caller : Principal, file : Types.VaultFile) : async Bool {
    if (not (await currentClubMember(caller, file.club))) return false;
    if (files.find(func(f) = f.id == file.id) != ?file) return false;
    switch (folders.find(func(f) = f.id == file.folder_id)) {
      case null file.folder_id == "";
      case (?folder) folder.club == file.club and folder.competition_id == file.competition_id and canViewFolder(caller, folder)
    }
  };
  func accountFiles(caller : Principal, candidates : [Types.VaultFile]) : async [Types.VaultFile] {
    let authority = club_domain_canister;
    var out : [Types.VaultFile] = [];
    // Bound authorization work; unbounded club reads remain a release blocker.
    if (candidates.size() > 200) Runtime.trap("Use bounded vault pages");
    for (file in candidates.values()) { if (await accountFileAccess(caller, file)) out := out.concat([file]) };
    await admitAccount(caller);
    if (authority != club_domain_canister) return [];
    // Re-evaluate local permissions after the final remote await.
    out.filter(func(file) = files.find(func(f) = f.id == file.id) == ?file and not isFenced(file.club) and
      (switch (folders.find(func(f) = f.id == file.folder_id)) { case null file.folder_id == ""; case (?folder) canViewFolder(caller, folder) }))
  };

  // Protected consensus reads for the opt-in local account-removal rehearsal.
  public shared ({ caller }) func read_account_list_folders(club : Text, team : ?Text, mini_league_id : ?Text) : async { #Ok : [Types.VaultFolder]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller); auth(caller);
    if (not (await currentClubMember(caller, club))) return #Err("Club membership required");
    #Ok(folders.filter(func(item) = item.club == club and item.competition_id == null and item.deleted_at_ms == null and
      (team == null or item.team == team or item.team == null) and (mini_league_id == null or item.mini_league_id == mini_league_id) and canViewFolder(caller, item)))
  
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
        if (folder.competition_id != null or not canViewFolder(caller, folder)) return #Ok([]);
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
        if (folder.competition_id != null or not canViewFolder(caller, folder)) return #Ok([]);
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
        case (?folder) { canViewFolder(caller, folder) };
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
        case (?folder) { canViewFolder(caller, folder) };
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
    #Ok(pinned_vaults.find(func(item) = item.chat_type == chat_type and item.chat_id == chat_id))
  
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
