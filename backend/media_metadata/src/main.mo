import AccountAdmission "../../shared/AccountAdmission";
import RemovalReceiver "../../shared/RemovalReceiver";
import RemovalEndpoints "../../shared/RemovalEndpoints";
import Map "mo:core/Map";
import Error "mo:core/Error";
import MediaEvidence "../../shared/MediaEvidence";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Iter "mo:core/Iter";
import Text "mo:core/Text";
import Int "mo:core/Int";
import Time "mo:core/Time";
import Types "types";
import AssetPaging "AssetPaging";

persistent actor class Main(governorInit : Principal) = this {
  // Local rehearsal only. Eligibility never grants resource permissions.
  transient let accountAdmissionEnabled = Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == ?"1";
  transient let accountAdmissionAuthority = switch (Runtime.envVar<system>("IGNITE_ACCOUNT_SERVICE_IDENTITY")) {
    case (?id) ?Principal.fromText(id); case null null
  };
  transient let accountAdmission = AccountAdmission.Gate(accountAdmissionEnabled, accountAdmissionAuthority);
  var removal_intents : Map.Map<Text, RemovalReceiver.Request>;
  var removal_subjects : Map.Map<Principal, Text>;
  var removal_active : Map.Map<Principal, Nat>;
  transient let removalReceiver = RemovalReceiver.Gate(accountAdmissionEnabled, accountAdmissionAuthority, removal_intents, removal_subjects, removal_active);
  include RemovalEndpoints(removalReceiver, Principal.fromActor(this), func _ = 0);
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
    [("permission_source", "local_club_roles")]
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

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };

  var assets : [Types.Asset];
  var assetPageIndex : AssetPaging.Index;
  var assetPageBuildPosition : Nat;
  var capabilities : [Types.Capability];
  var reactions : [Types.Reaction];
  var comments : [Types.Comment];
  var galleryClubAuthority : ?Principal;
  var galleryVaultAuthority : ?Principal;
  var galleryNoticeAttempts : Map.Map<Text, Text>;
  var hiddenGalleryAssets : Map.Map<Text, Bool>;
  var galleryViewCounts : Map.Map<Text, Nat>;
  var roles : [Types.RoleGrant];
  var bulkAccessPrincipals : [Principal];
  var galleryChatCards : [Types.GalleryChatCard];
  // Photo albums (migration 20261110_000000): named groupings referenced by
  // Asset.album_id.
  var albums : [Types.Album];
  var transferFences : [Text];

  transient let MAX_ASSETS = 20_000;
  transient let MAX_CAPABILITIES = 20_000;
  transient let MAX_REACTIONS = 20_000;
  transient let MAX_COMMENTS = 20_000;
  transient let MAX_ROLES = 5_000;
  transient let MAX_BULK_ACCESS = 200;
  transient let MAX_GALLERY_CHAT_CARDS = 20_000;
  transient let MAX_PHOTO_IDS = 200;

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };


  // ---- Club transfer fence + snapshot (governor-only operator tooling) ----
  // Inspect is advisory only; the runner re-digests the source before cutover.
  func fenceGov(caller : Principal) : Bool = not caller.equal(Principal.anonymous()) and governor.equal(caller);
  func isFenced(club : Text) : Bool = transferFences.any(func(c) = c == club);
  func fenceBlobHas(hay : Blob, needle : Text) : Bool {
    let h = Blob.toArray(hay); let n = Blob.toArray(Text.encodeUtf8(needle));
    if (n.size() == 0 or n.size() > h.size()) return false;
    var i = 0;
    while (i + n.size() <= h.size()) { var j = 0; while (j < n.size() and h[i + j] == n[j]) j += 1; if (j == n.size()) return true; i += 1 };
    false
  };
  system func inspect({ caller : Principal; arg : Blob }) : Bool {
    if (transferFences.size() == 0 or fenceGov(caller)) return true;
    not transferFences.any(func(c) = fenceBlobHas(arg, c))
  };
  public shared ({ caller }) func set_transfer_fence(club : Text, fenced : Bool) : async { #Ok; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    mediaEvidenceRevision += 1;
    transferFences := transferFences.filter(func(c) = c != club);
    mediaEvidenceRevision += 1;
    if (fenced) transferFences := transferFences.concat([club]);
    #Ok
  };
  func assetFenced(id : Text) : Bool = transferFences.size() > 0 and assets.any(func(x) = x.id == id and isFenced(x.club_id));
  type FenceSnapshot = { assets : [Types.Asset]; capabilities : [Types.Capability]; reactions : [Types.Reaction]; comments : [Types.Comment]; roles : [Types.RoleGrant]; cards : [Types.GalleryChatCard]; albums : ?[Types.Album] };
  func fenceSnapshot(c : Text) : FenceSnapshot {
    let rootA = assets.filter(func(x) = x.club_id == c);
    let inA = func(k : Text) : Bool = rootA.any(func(x) = x.id == k);
    { assets = assets.filter(func(x) = x.club_id == c);
      capabilities = capabilities.filter(func(x) = inA(x.asset_id));
      reactions = reactions.filter(func(x) = inA(x.asset_id));
      comments = comments.filter(func(x) = inA(x.asset_id));
      roles = roles.filter(func(x) = x.club_id == ?c);
      cards = galleryChatCards.filter(func(x) = x.club_id == c);
      albums = ?albums.filter(func(x) = x.club_id == c) }
  };
  func fenceDrop(c : Text) {
    let rootA = assets.filter(func(x) = x.club_id == c);
    let inA = func(k : Text) : Bool = rootA.any(func(x) = x.id == k);
    mediaEvidenceRevision += 1;
    assets := assets.filter(func(x) = not (x.club_id == c));
    // Physical replacement changes locators; rebuild in bounded operator batches.
    assetPageIndex := Map.empty<Text, Map.Map<Text, Nat>>();
    assetPageBuildPosition := 0;
    capabilities := capabilities.filter(func(x) = not (inA(x.asset_id)));
    reactions := reactions.filter(func(x) = not (inA(x.asset_id)));
    comments := comments.filter(func(x) = not (inA(x.asset_id)));
    roles := roles.filter(func(x) = not (x.club_id == ?c));
    mediaEvidenceRevision += 1;
    galleryChatCards := galleryChatCards.filter(func(x) = not (x.club_id == c));
    albums := albums.filter(func(x) = not (x.club_id == c));
  };
  public query ({ caller }) func export_club_snapshot(club : Text) : async { #Ok : Blob; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before export");
    #Ok(to_candid (fenceSnapshot(club)))
  };
  public shared ({ caller }) func import_club_snapshot(club : Text, snapshot : Blob) : async { #Ok : Nat; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before import");
    let decoded : ?FenceSnapshot = from_candid (snapshot);
    let s = switch (decoded) { case (?x) x; case null return #Err("Invalid snapshot") };
    if (removalReceiver.snapshotDenied(snapshot)) return #Err("Snapshot references fenced account");
    let c = club;
    let rootA = s.assets;
    let inA = func(k : Text) : Bool = rootA.any(func(x) = x.id == k);
    if (s.assets.any(func(x) = not (x.club_id == c))
        or s.capabilities.any(func(x) = not (inA(x.asset_id)))
        or s.reactions.any(func(x) = not (inA(x.asset_id)))
        or s.comments.any(func(x) = not (inA(x.asset_id)))
        or s.roles.any(func(x) = not (x.club_id == ?c))
        or s.cards.any(func(x) = not (x.club_id == c))) return #Err("Snapshot contains foreign records");
    let incomingAlbums = s.albums ?? [];
    if (incomingAlbums.any(func(x) = x.club_id != c)) return #Err("Snapshot contains foreign records");
    if (incomingAlbums.any(func(x) = switch (x.cover_asset_id) { case (?cover) { not inA(cover) }; case null { false } })) return #Err("Album cover references a foreign asset");
    if (s.assets.any(func(a) = switch (a.album_id) { case (?al) { not incomingAlbums.any(func(x) = x.id == al) }; case null { false } })) return #Err("Asset references an unknown album");
    if (s.assets.any(func(e) = assets.any(func(x) = x.id == e.id and x.club_id != club)) or incomingAlbums.any(func(e) = albums.any(func(x) = x.id == e.id and x.club_id != club))) return #Err("Snapshot id collides with another club");
    fenceDrop(club); // idempotent replace
    mediaEvidenceRevision += 1;
    assets := assets.concat(s.assets);
    capabilities := capabilities.concat(s.capabilities);
    reactions := reactions.concat(s.reactions);
    comments := comments.concat(s.comments);
    roles := roles.concat(s.roles);
    mediaEvidenceRevision += 1;
    galleryChatCards := galleryChatCards.concat(s.cards);
    albums := albums.concat(incomingAlbums);
    #Ok(s.assets.size())
  };
  public shared ({ caller }) func purge_club_snapshot(club : Text) : async { #Ok : Nat; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before purge");
    let n = fenceSnapshot(club).assets.size(); fenceDrop(club); #Ok(n)
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required");
  };

  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };

  func validLong(value : Text, max : Nat) : Bool { value != "" and value.size() <= max };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func hasBulkAccess(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and bulkAccessPrincipals.any(func(p) = p.equal(caller))
  };

  func validCapabilityAction(action : Text) : Bool { action == "upload" or action == "download" or action == "delete" };

  func validMime(mime : Text) : Bool {
    mime.size() <= 128 and Text.contains(mime, #text "/") and Iter.all(Text.toIter(mime), func(character) = not Char.isWhitespace(character))
  };

  func validPurpose(purpose : Text) : Bool { purpose != "" and purpose.size() <= 128 };
  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };

  func validRoleAssignment(role : Text, club_id : ?Text, team_id : ?Text) : Bool {
    switch (role) {
      case ("member" or "club_admin") { club_id != null and team_id == null };
      case ("team_admin" or "coach") { club_id != null and team_id != null };
      case (_) { false };
    }
  };

  func hasRole(caller : Principal, role : Text, club_id : ?Text) : Bool {
    roles.any(func(grant) {
      grant.user.equal(caller) and grant.role == role and grant.club_id == club_id
    })
  };

  // Club/team membership is intentionally coarse for the lab: any granted
  // role scoped to the asset's club (member, admin, coach) counts as a
  // viewer, matching the source app's "any club member can see club media"
  // rule without replicating its full roster sync.
  func isClubMember(caller : Principal, club_id : Text) : Bool {
    isGovernor(caller)
      or hasRole(caller, "member", ?club_id)
      or hasRole(caller, "club_admin", ?club_id)
      or hasRole(caller, "team_admin", ?club_id)
      or hasRole(caller, "coach", ?club_id)
  };

  // Club staff (not plain members) — used to gate gallery-card creation and
  // moderation, matching the source app's "team admin/coach/club admin can
  // post or remove a gallery card" rule.
  func isClubStaff(caller : Principal, club_id : Text) : Bool {
    isGovernor(caller)
      or hasRole(caller, "club_admin", ?club_id)
      or hasRole(caller, "team_admin", ?club_id)
      or hasRole(caller, "coach", ?club_id)
  };

  func canView(caller : Principal, asset : Types.Asset) : Bool {
    not asset.deleted and hiddenGalleryAssets.get(asset.id) != ?true and asset.expires_at_ms > nowMs()
      and (asset.owner.equal(caller) or isGovernor(caller) or asset.visibility == "public" or isClubMember(caller, asset.club_id))
  };

  func validReactionKind(kind : Text) : Bool { kind != "" and kind.size() <= 32 };

  func validCommentBody(body : Text) : Bool { body != "" and body.size() <= 2000 };

  public shared ({ caller }) func register_asset(
    club_id : Text,
    kind : Text,
    mime : Text,
    checksum : Text,
    storage_path : Text,
    visibility : Text,
    expires_at_ms : Nat64,
  ) : async { #Ok : Types.Asset; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(club_id) or not valid(kind) or not validMime(mime) or not valid(checksum) or not validLong(storage_path, 512) or not valid(visibility)) return #Err("Invalid asset");
    if (assets.size() >= MAX_ASSETS) return #Err("Asset limit reached");
    let encrypted = kind == "child_photo" or kind == "minor_media";
    if (encrypted and visibility == "public") return #Err("Child-sensitive media cannot be public");
    if (expires_at_ms <= nowMs()) return #Err("Asset expiry must be in the future");
    let asset : Types.Asset = {
      id = "asset-" # club_id # "-" # Nat.toText(assets.size() + 1);
      club_id;
      owner = caller;
      kind;
      mime;
      checksum;
      storage_path;
      blob_ref = null;
      visibility;
      content_length = 0;
      encrypted;
      child_sensitive = encrypted;
      retention_until_ms = expires_at_ms;
      deleted = false;
      expires_at_ms;
      created_at_ms = nowMs();
      team_id = null;
      mini_league_id = null;
      competition_id = null;
      event_id = null;
      caption = null;
      album_id = null;
    };
    mediaEvidenceRevision += 1;
    assets := assets.concat([asset]);
    AssetPaging.add(assetPageIndex, asset, assets.size() - 1);
    if (assetPageBuildPosition == assets.size() - 1) assetPageBuildPosition += 1;
    #Ok(asset)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Tags a registered asset with its audience scope (team / mini league /
  // competition / event), caption and album grouping. Kept separate from
  // register_asset so the registration signature stays stable; the frontend
  // calls this immediately after registering. Owner or club staff may tag.
  public shared ({ caller }) func set_asset_scope(
    asset_id : Text,
    team_id : ?Text,
    mini_league_id : ?Text,
    competition_id : ?Text,
    event_id : ?Text,
    caption : ?Text,
    album_id : ?Text,
  ) : async { #Ok : Types.Asset; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (assetFenced(asset_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    func validOptLength(value : ?Text, max : Nat) : Bool {
      switch (value) { case null { true }; case (?v) { v.size() <= max } };
    };
    if (not validOptLength(team_id, 128) or not validOptLength(mini_league_id, 128) or not validOptLength(competition_id, 128) or not validOptLength(event_id, 128) or not validOptLength(album_id, 128) or not validOptLength(caption, 2000)) return #Err("Invalid scope");
    var found_idx : ?Nat = null;
    var idx = 0;
    for (a in assets.values()) {
      if (a.id == asset_id and not a.deleted) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Asset not found") };
      case (?i) {
        let asset = assets[i];
        if (not asset.owner.equal(caller) and not isClubStaff(caller, asset.club_id)) return #Err("Asset owner or club staff required");
        let updated : Types.Asset = { asset with team_id; mini_league_id; competition_id; event_id; caption; album_id };
        mediaEvidenceRevision += 1;
        assets := Array.tabulate<Types.Asset>(assets.size(), func(position) {
          if (position == i) updated else assets[position]
        });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Points an asset at bytes held by an ICP blob-store canister instead of
  // the off-chain storage_path. The blob store is a separate canister; this
  // canister only records where the bytes live. Passing null clears the
  // pointer and returns the asset to off-chain storage resolution.
  public shared ({ caller }) func set_blob_ref(asset_id : Text, blob_ref : ?Types.BlobRef) : async { #Ok : Types.Asset; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (assetFenced(asset_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (a in assets.values()) {
      if (a.id == asset_id and not a.deleted) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Asset not found") };
      case (?i) {
        let asset = assets[i];
        if (not asset.owner.equal(caller) and not isGovernor(caller)) return #Err("Asset owner required");
        switch (blob_ref) {
          case (?r) {
            if (not valid(r.canister) or not valid(r.path) or not valid(r.content_hash)) return #Err("Invalid blob reference");
          };
          case null {};
        };
        let updated : Types.Asset = { asset with blob_ref };
        mediaEvidenceRevision += 1;
        assets := Array.tabulate<Types.Asset>(assets.size(), func(position) {
          if (position == i) updated else assets[position]
        });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func issue_capability(asset_id : Text, action : Text, purpose : Text, expires_at_ms : Nat64) : async { #Ok : Types.Capability; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (assetFenced(asset_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validCapabilityAction(action) or not validPurpose(purpose) or expires_at_ms <= nowMs()) return #Err("Invalid or expired capability");
    if (capabilities.size() >= MAX_CAPABILITIES) return #Err("Capability limit reached");
    var found_asset : ?Types.Asset = null;
    for (a in assets.values()) {
      if (a.id == asset_id) { found_asset := ?a };
    };
    switch (found_asset) {
      case null { #Err("Asset not found") };
      case (?asset) {
        if (not asset.owner.equal(caller)) return #Err("Asset owner required");
        let capability : Types.Capability = { asset_id; action; owner = caller; allowed = true; purpose; expires_at_ms };
        capabilities := capabilities.concat([capability]);
        #Ok(capability)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_asset(asset_id : Text) : async ?Types.Asset {
    denyLegacyAccountQuery();
    for (a in assets.values()) {
      if (a.id == asset_id and not a.deleted and canView(caller, a)) return ?a;
    };
    null
  };

  public shared ({ caller }) func delete_asset(asset_id : Text) : async { #Ok : Types.Asset; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (assetFenced(asset_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (a in assets.values()) {
      if (a.id == asset_id) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Asset not found") };
      case (?i) {
        let asset = assets[i];
        if (not (await galleryManager(caller, asset))) return #Err("Asset owner or scoped staff required");
        if (assetFenced(asset_id) or assets[i] != asset) return #Err("Asset changed during authorization");
        let updated : Types.Asset = { asset with deleted = true; retention_until_ms = 0 };
        mediaEvidenceRevision += 1;
        assets := Array.tabulate<Types.Asset>(assets.size(), func(position) {
          if (position == i) updated else assets[position]
        });
        capabilities := capabilities.filter(func(cap) = cap.asset_id != asset_id);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : ?Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not validRoleAssignment(role, club_id, team_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(grant) = grant.user.equal(principal) and grant.role == role and grant.club_id == club_id and grant.team_id == team_id)) {
      if (roles.size() >= MAX_ROLES) return #Err("Role limit reached");
      mediaEvidenceRevision += 1;
      roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Team-level scoping is not modeled by this canister's Asset type yet; the
  // lab feed filters by club only, matching the source app's club-wide view.
  public query ({ caller }) func list_assets(club_id : Text) : async [Types.Asset] {
    denyLegacyAccountQuery();
    if (caller.equal(Principal.anonymous())) return [];
    Array.filter<Types.Asset>(assets, func(a) {
      not a.deleted and hiddenGalleryAssets.get(a.id) != ?true and a.club_id == club_id and canView(caller, a)
    })
  };

  // Backfill is explicit, governor-only and restart-safe; never run on page open.
  public shared ({ caller }) func build_asset_page_index() : async { #Ok : { scanned : Nat; complete : Bool }; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    let start = assetPageBuildPosition;
    let end = Nat.min(start + 200, assets.size());
    for (position in Nat.range(start, end)) AssetPaging.add(assetPageIndex, assets[position], position);
    assetPageBuildPosition := end;
    #Ok({ scanned = end - start; complete = end == assets.size() })
  };

  func assetPage(caller : Principal, club_id : Text, cursor : ?AssetPaging.Cursor, limit : Nat) : AssetPaging.Result {
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (assetPageBuildPosition != assets.size()) return #Err("Media page index not ready");
    // Resolve club-role visibility once, rather than scanning roles per asset.
    let member = isClubMember(caller, club_id);
    let gov = isGovernor(caller);
    let now = nowMs();
    AssetPaging.read(assetPageIndex, assets, club_id, mediaEvidenceRevision, cursor, limit,
      func a = hiddenGalleryAssets.get(a.id) != ?true and a.expires_at_ms > now and (a.owner.equal(caller) or gov or a.visibility == "public" or member))
  };

  public query ({ caller }) func list_assets_page(club_id : Text, cursor : ?AssetPaging.Cursor, limit : Nat) : async AssetPaging.Result {
    denyLegacyAccountQuery();
    assetPage(caller, club_id, cursor, limit)
  };

  public shared ({ caller }) func read_account_list_assets_page(club_id : Text, cursor : ?AssetPaging.Cursor, limit : Nat) : async AssetPaging.Result {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
      await admitAccount(caller);
      if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback");
      assetPage(caller, club_id, cursor, limit)
    } finally { removalReceiver.leave(caller) }
  };

  public shared ({ caller }) func add_reaction(asset_id : Text, kind : Text, created_at_ms : Nat64) : async { #Ok : Types.Reaction; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (assetFenced(asset_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validReactionKind(kind)) return #Err("Invalid reaction kind");
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id and not a.deleted) { found := ?a } };
    switch (found) {
      case null { #Err("Asset not found") };
      case (?asset) {
        if (not canView(caller, asset)) return #Err("Not authorized to react to this asset");
        // Supabase parity: a user holds exactly one reaction per asset —
        // replace any prior reaction (regardless of kind), never accumulate.
        reactions := reactions.filter(func(r) = not (r.asset_id == asset_id and r.user.equal(caller)));
        if (reactions.size() >= MAX_REACTIONS) return #Err("Reaction limit reached");
        let reaction : Types.Reaction = { asset_id; user = caller; kind; created_at_ms };
        reactions := reactions.concat([reaction]);
        ignore await galleryNotice(asset, caller, "photo_reaction", "reaction-" # asset_id # "-" # caller.toText() # "-" # created_at_ms.toText(), null);
        #Ok(reaction)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_reaction(asset_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (assetFenced(asset_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    reactions := reactions.filter(func(r) = not (r.asset_id == asset_id and r.user.equal(caller)));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_reactions(asset_id : Text) : async [Types.Reaction] {
    denyLegacyAccountQuery();
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id) { found := ?a } };
    switch (found) {
      case null { [] };
      case (?asset) {
        if (not canView(caller, asset)) return [];
        Array.filter<Types.Reaction>(reactions, func(r) = r.asset_id == asset_id)
      };
    }
  };

  public shared ({ caller }) func add_comment(asset_id : Text, body : Text, created_at_ms : Nat64) : async { #Ok : Types.Comment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (assetFenced(asset_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validCommentBody(body)) return #Err("Invalid comment");
    if (comments.size() >= MAX_COMMENTS) return #Err("Comment limit reached");
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id and not a.deleted) { found := ?a } };
    switch (found) {
      case null { #Err("Asset not found") };
      case (?asset) {
        if (not canView(caller, asset)) return #Err("Not authorized to comment on this asset");
        let comment : Types.Comment = {
          id = "comment-" # asset_id # "-" # Nat.toText(comments.size() + 1);
          asset_id;
          author = caller;
          body;
          reply_to_id = null;
          created_at_ms;
          deleted = false;
        };
        comments := comments.concat([comment]);
        ignore await galleryNotice(asset, caller, "photo_comment", comment.id, null);
        #Ok(comment)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_comments(asset_id : Text) : async [Types.Comment] {
    denyLegacyAccountQuery();
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id) { found := ?a } };
    switch (found) {
      case null { [] };
      case (?asset) {
        if (not canView(caller, asset)) return [];
        Array.filter<Types.Comment>(comments, func(c) = c.asset_id == asset_id and not c.deleted)
      };
    }
  };

  public shared ({ caller }) func delete_comment(comment_id : Text) : async { #Ok : Types.Comment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (c in comments.values()) {
      if (c.id == comment_id) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Comment not found") };
      case (?i) {
        let comment = comments[i];
        if (not comment.author.equal(caller) and not isGovernor(caller)) return #Err("Comment author required");
        let updated : Types.Comment = { comment with deleted = true };
        comments := Array.tabulate<Types.Comment>(comments.size(), func(position) {
          if (position == i) updated else comments[position]
        });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };


  public shared ({ caller }) func set_gallery_authorities(club : Principal, vault : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or Principal.isAnonymous(club) or Principal.isAnonymous(vault)) return #Err("Governor and valid authorities required");
    galleryClubAuthority := ?club; galleryVaultAuthority := ?vault; #Ok
  };
  func galleryManager(user : Principal, asset : Types.Asset) : async Bool {
    if (removalReceiver.denied(user) or isFenced(asset.club_id)) return false;
    if (asset.owner.equal(user) or isGovernor(user)) return true;
    let id = galleryClubAuthority ?? return false;
    let club : actor { read_account_list_user_club_roles : shared (Principal, Text) -> async [(Text, ?Text)]; read_account_is_app_admin : shared (Principal) -> async Bool } = actor(id.toText());
    let grants = await (with timeout = 10) club.read_account_list_user_club_roles(user, asset.club_id);
    let allowed = grants.any(func (role, team) = role == "club_admin" or role == "committee" or (asset.team_id != null and team == asset.team_id and (role == "team_admin" or role == "coach")));
    let admin = if (allowed) false else await (with timeout = 10) club.read_account_is_app_admin(user);
    (allowed or admin) and galleryClubAuthority == ?id and not removalReceiver.denied(user) and not isFenced(asset.club_id)
  };
  func galleryNotice(asset : Types.Asset, user : Principal, kind : Text, rawKey : Text, parent : ?Principal) : async Text {
    let key = asset.club_id # ":" # asset.owner.toText() # ":" # rawKey;
    if (galleryNoticeAttempts.get(key) == null and galleryNoticeAttempts.size() >= MAX_COMMENTS + MAX_REACTIONS + MAX_ASSETS) return "capacity";
    if (galleryNoticeAttempts.get(key) != null) return galleryNoticeAttempts.get(key) ?? "unknown";
    let id = galleryClubAuthority ?? return "not_configured";
    if (removalReceiver.denied(user) or assetFenced(asset.id)) return "denied";
    galleryNoticeAttempts.add(key, "unknown");
    let club : actor { relay_gallery_notice : shared (Principal, Text, ?Text, Principal, ?Principal, Text, Text, Text) -> async { #Ok : Nat16; #Err : Text } } = actor(id.toText());
    try {
      let result = await (with timeout = 10) club.relay_gallery_notice(user, asset.club_id, asset.team_id, asset.owner, parent, kind, key, asset.id);
      let status = switch result { case (#Ok(_)) "queued"; case (#Err(_)) "refused" };
      galleryNoticeAttempts.add(key, status); status
    } catch (_) { "unknown" }
  };
  public shared ({ caller }) func announce_gallery_asset(asset_id : Text) : async { #Ok : Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller);
      let asset = assets.find(func a = a.id == asset_id and not a.deleted) ?? return #Err("Asset not found");
      if (not asset.owner.equal(caller) or assetFenced(asset_id)) return #Err("Asset owner required");
      #Ok(await galleryNotice(asset, caller, "photo_uploaded", "upload-" # (asset.album_id ?? asset.id), null))
    } finally { removalReceiver.leave(caller) }
  };
  public shared ({ caller }) func add_comment_reply(asset_id : Text, body : Text, reply_to_id : ?Text) : async { #Ok : Types.Comment; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller); auth(caller);
      let asset = assets.find(func a = a.id == asset_id and not a.deleted) ?? return #Err("Asset not found");
      if (assetFenced(asset_id) or not canView(caller, asset)) return #Err("Asset access required");
      if (not validCommentBody(body) or comments.size() >= MAX_COMMENTS) return #Err("Invalid comment or capacity reached");
      var parent : ?Principal = null;
      switch reply_to_id { case (?id) {
        let row = comments.find(func c = c.id == id and c.asset_id == asset_id and not c.deleted) ?? return #Err("Reply parent not found in this asset");
        parent := ?row.author;
      }; case null {} };
      let comment : Types.Comment = { id = "comment-" # asset_id # "-" # Nat.toText(comments.size() + 1); asset_id; author = caller; body; reply_to_id; created_at_ms = nowMs(); deleted = false };
      comments := comments.concat([comment]);
      ignore await galleryNotice(asset, caller, if (reply_to_id == null) "photo_comment" else "comment_reply", comment.id, parent);
      #Ok(comment)
    } finally { removalReceiver.leave(caller) }
  };
  public shared ({ caller }) func record_gallery_view(asset_id : Text) : async { #Ok : Nat; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try { await admitAccount(caller); auth(caller);
      let asset = assets.find(func a = a.id == asset_id) ?? return #Err("Asset not found");
      if (not canView(caller, asset) or assetFenced(asset_id)) return #Err("Asset access required");
      let count = (galleryViewCounts.get(asset_id) ?? 0) + 1;
      galleryViewCounts.add(asset_id, count); #Ok(count)
    } finally { removalReceiver.leave(caller) }
  };
  public shared ({ caller }) func read_gallery_view_counts(ids : [Text]) : async { #Ok : [(Text, Nat)]; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try { await admitAccount(caller); auth(caller);
      if (ids.size() > 300) return #Err("Too many assets");
      var rows : [(Text, Nat)] = [];
      for (id in ids.values()) { switch (assets.find(func a = a.id == id)) {
        case (?a) { if (canView(caller, a) and not assetFenced(id)) rows := rows.concat([(id, galleryViewCounts.get(id) ?? 0)]) };
        case null {};
      } }; #Ok(rows)
    } finally { removalReceiver.leave(caller) }
  };
  public shared ({ caller }) func read_gallery_asset_for_service(user : Principal, asset_id : Text) : async { #Ok : Types.Asset; #Err : Text } {
    if (galleryVaultAuthority != ?caller) return #Err("Vault authority required");
    await admitAccount(user);
    let asset = assets.find(func a = a.id == asset_id and not a.deleted) ?? return #Err("Asset not found");
    if (not (asset.expires_at_ms > nowMs() and (asset.owner.equal(user) or isGovernor(user) or asset.visibility == "public" or isClubMember(user, asset.club_id))) or assetFenced(asset_id) or galleryVaultAuthority != ?caller) return #Err("Asset access required");
    #Ok(asset)
  };
  public shared ({ caller }) func remove_gallery_asset(asset_id : Text, mode : Text) : async { #Ok : { vault_updated : Bool }; #Err : Text } {
    if (not removalReceiver.enter(caller)) return #Err("Account fenced");
    try {
      await admitAccount(caller);
      if (mode != "feed_only" and mode != "feed_and_vault") return #Err("Invalid deletion mode");
      let asset = assets.find(func a = a.id == asset_id) ?? return #Err("Asset not found");
      if (not (await galleryManager(caller, asset))) return #Err("Asset owner or scoped staff required");
      var vault_updated = false;
      if (mode == "feed_and_vault") {
        let id = galleryVaultAuthority ?? return #Err("Vault authority not configured");
        let vault : actor { trash_gallery_copy : shared (Principal, Text, Text) -> async { #Ok : Bool; #Err : Text } } = actor(id.toText());
        switch (await (with timeout = 10) vault.trash_gallery_copy(caller, asset_id, asset.club_id)) { case (#Err(e)) return #Err(e); case (#Ok(v)) vault_updated := v };
        if (galleryVaultAuthority != ?id) return #Err("Vault authority changed");
      };
      if (assetFenced(asset_id) or removalReceiver.denied(caller) or assets.find(func a = a.id == asset_id) != ?asset) return #Err("Asset changed during deletion");
      hiddenGalleryAssets.add(asset_id, true); mediaEvidenceRevision += 1;
      if (mode == "feed_and_vault") assets := assets.map(func a = if (a.id == asset_id) ({ a with deleted = true }) else a);
      #Ok({ vault_updated })
    } finally { removalReceiver.leave(caller) }
  };

  // ---------------- Gallery chat cards ----------------
  // Mirrors the Supabase gallery_chat_cards row shape (photo-share prompt
  // cards surfaced in team chat). Supabase remains the writer today — rows
  // are created by a DB trigger/edge function outside the frontend, not by
  // app code — so these methods exist so the II read path returns real data
  // once the lab is seeded, not to replace the Supabase writer.

  func validGalleryPhotoIds(photo_ids : [Text]) : Bool {
    photo_ids.size() <= MAX_PHOTO_IDS and Iter.all(photo_ids.values(), func(pid : Text) : Bool { valid(pid) })
  };

  func findGalleryCardIndex(card_id : Text) : ?Nat {
    var found_idx : ?Nat = null;
    var idx = 0;
    for (c in galleryChatCards.values()) {
      if (c.id == card_id) { found_idx := ?idx };
      idx += 1;
    };
    found_idx
  };

  public shared ({ caller }) func save_gallery_chat_card(
    id : ?Text,
    club_id : Text,
    team_id : Text,
    event_id : ?Text,
    message_id : Text,
    hero_photo_id : ?Text,
    hero_image_url : ?Text,
    photo_count : Nat32,
    photo_ids : [Text],
    is_prompt : Bool,
    push_sent : Bool,
  ) : async { #Ok : Types.GalleryChatCard; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(club_id) or not valid(team_id) or not valid(message_id)) return #Err("Invalid gallery chat card");
    if (not validGalleryPhotoIds(photo_ids)) return #Err("Too many photo ids");
    if (not is_prompt and (photo_ids.size() == 0 or Nat32.toNat(photo_count) != photo_ids.size())) return #Err("Gallery card requires exact photos");
    for (pid in photo_ids.values()) {
      let a = assets.find(func a = a.id == pid) ?? return #Err("Gallery photo not found");
      if (not canView(caller, a) or a.club_id != club_id or a.team_id != ?team_id or (not a.owner.equal(caller) and not isClubStaff(caller, club_id))) return #Err("Gallery photo scope or owner mismatch");
    };
    if (hero_photo_id != null and not photo_ids.any(func pid = ?pid == hero_photo_id)) return #Err("Hero must belong to gallery photos");
    if (id == null) {
      switch (galleryChatCards.find(func c = c.message_id == message_id and c.uploader_id.equal(caller))) {
        case (?existing) { if (existing.club_id == club_id and existing.team_id == team_id and existing.photo_ids == photo_ids) return #Ok(existing) else return #Err("Gallery card receipt conflict") };
        case null {};
      }
    };
    switch (id) {
      case null {
        if (is_prompt and not isClubStaff(caller, club_id)) return #Err("Club staff required for prompts");
        if (galleryChatCards.size() >= MAX_GALLERY_CHAT_CARDS) return #Err("Gallery chat card limit reached");
        let now = nowMs();
        let card : Types.GalleryChatCard = {
          id = "gallery-card-" # team_id # "-" # Nat.toText(galleryChatCards.size() + 1);
          club_id;
          team_id;
          event_id;
          message_id;
          hero_photo_id;
          hero_image_url;
          photo_count;
          photo_ids;
          is_prompt;
          push_sent;
          uploader_id = caller;
          created_at_ms = now;
          updated_at_ms = now;
        };
        mediaEvidenceRevision += 1;
        galleryChatCards := galleryChatCards.concat([card]);
        #Ok(card)
      };
      case (?card_id) {
        switch (findGalleryCardIndex(card_id)) {
          case null { #Err("Gallery chat card not found") };
          case (?i) {
            let existing = galleryChatCards[i];
            if (existing.club_id != club_id or existing.team_id != team_id) return #Err("Gallery card scope is immutable");
            if (not existing.uploader_id.equal(caller) and not isClubStaff(caller, existing.club_id)) return #Err("Card author or club staff required");
            let updated : Types.GalleryChatCard = {
              existing with
              club_id;
              team_id;
              event_id;
              message_id;
              hero_photo_id;
              hero_image_url;
              photo_count;
              photo_ids;
              is_prompt;
              push_sent;
              updated_at_ms = nowMs();
            };
            mediaEvidenceRevision += 1;
            galleryChatCards := Array.tabulate<Types.GalleryChatCard>(galleryChatCards.size(), func(position) {
              if (position == i) updated else galleryChatCards[position]
            });
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_gallery_chat_card(card_id : Text) : async ?Types.GalleryChatCard {
    denyLegacyAccountQuery();
    for (c in galleryChatCards.values()) {
      if (c.id == card_id and isClubMember(caller, c.club_id)) return ?c;
    };
    null
  };

  public query ({ caller }) func list_gallery_chat_cards(club_id : Text, team_id : Text) : async [Types.GalleryChatCard] {
    denyLegacyAccountQuery();
    if (caller.equal(Principal.anonymous()) or not isClubMember(caller, club_id)) return [];
    Array.filter<Types.GalleryChatCard>(galleryChatCards, func(c) = c.club_id == club_id and c.team_id == team_id)
  };

  public shared ({ caller }) func delete_gallery_chat_card(card_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (findGalleryCardIndex(card_id)) {
      case null { #Err("Gallery chat card not found") };
      case (?i) {
        let existing = galleryChatCards[i];
        if (not existing.uploader_id.equal(caller) and not isClubStaff(caller, existing.club_id)) return #Err("Card author or club staff required");
        mediaEvidenceRevision += 1;
        galleryChatCards := galleryChatCards.filter(func(c) = c.id != card_id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func addBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (not bulkAccessPrincipals.any(func(p) = p.equal(principal))) {
      if (bulkAccessPrincipals.size() >= MAX_BULK_ACCESS) return #Err("Bulk access limit reached");
      bulkAccessPrincipals := bulkAccessPrincipals.concat([principal]);
    };
    #Ok
  };

  public shared ({ caller }) func removeBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(principal));
    #Ok
  };

  public query ({ caller }) func listBulkAccessPrincipals() : async { #Ok : [Principal]; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok(bulkAccessPrincipals)
  };

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor only");
    #Ok({ schema = 4; governor; assets; capabilities; reactions; comments; roles; galleryChatCards; albums })
  };

  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Account removal fenced");
    rekeyImpl(caller, old, new, dry_run, false)
  };

  // Same as rekey_principal, but allowed when the new sign-in ID already has data:
  // both IDs' records end up under the new one (keyed duplicates keep the new row).
  public shared ({ caller }) func merge_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    rekeyImpl(caller, old, new, dry_run, true)
  };

  func rekeyImpl(caller : Principal, old : Principal, new : Principal, dry_run : Bool, allowMerge : Bool) : { #ok : Nat; #err : Text } {
    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Account removal fenced");
    if (not isGovernor(caller)) return #err("Forbidden");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #err("Invalid principal");
    if (old.equal(new)) return #err("Old and new principal must differ");
    if (old.equal(governor)) return #err("Cannot rekey the governor");

    var conflicts = 0;
    for (a in assets.values()) { if (a.owner.equal(new)) conflicts += 1 };
    for (c in capabilities.values()) { if (c.owner.equal(new)) conflicts += 1 };
    for (r in reactions.values()) { if (r.user.equal(new)) conflicts += 1 };
    for (c in comments.values()) { if (c.author.equal(new)) conflicts += 1 };
    for (g in roles.values()) { if (g.user.equal(new)) conflicts += 1 };
    for (p in bulkAccessPrincipals.values()) { if (p.equal(new)) conflicts += 1 };
    for (c in galleryChatCards.values()) { if (c.uploader_id.equal(new)) conflicts += 1 };
    for (a in albums.values()) { if (a.created_by.equal(new)) conflicts += 1 };
    if (conflicts > 0 and not allowMerge) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in media_metadata");

    var changed = 0;

    let newAssets = Array.map<Types.Asset, Types.Asset>(assets, func(a) { if (a.owner.equal(old)) { changed += 1; { a with owner = new } } else a });
    let newCapabilities = Array.map<Types.Capability, Types.Capability>(capabilities, func(c) { if (c.owner.equal(old)) { changed += 1; { c with owner = new } } else c });
    let newReactions = Array.map<Types.Reaction, Types.Reaction>(reactions, func(r) { if (r.user.equal(old)) { changed += 1; { r with user = new } } else r });
    let newComments = Array.map<Types.Comment, Types.Comment>(comments, func(c) { if (c.author.equal(old)) { changed += 1; { c with author = new } } else c });

    var newRoles : [Types.RoleGrant] = [];
    for (g in roles.values()) {
      if (g.user.equal(old)) {
        changed += 1;
        let dup = Array.find<Types.RoleGrant>(roles, func(o) = o.user.equal(new) and o.role == g.role and o.club_id == g.club_id and o.team_id == g.team_id);
        switch (dup) {
          case (?_) {};
          case null { newRoles := Array.concat(newRoles, [{ g with user = new }]) };
        };
      } else { newRoles := Array.concat(newRoles, [g]) };
    };

    var newBulk : [Principal] = [];
    for (p in bulkAccessPrincipals.values()) {
      if (p.equal(old)) {
        changed += 1;
        if (not bulkAccessPrincipals.any(func(o) = o.equal(new))) { newBulk := Array.concat(newBulk, [new]) };
      } else { newBulk := Array.concat(newBulk, [p]) };
    };

    let newGalleryChatCards = Array.map<Types.GalleryChatCard, Types.GalleryChatCard>(galleryChatCards, func(c) { if (c.uploader_id.equal(old)) { changed += 1; { c with uploader_id = new } } else c });
    let newAlbums = Array.map<Types.Album, Types.Album>(albums, func(a) { if (a.created_by.equal(old)) { changed += 1; { a with created_by = new } } else a });

    if (not dry_run and changed > 0) {
      mediaEvidenceRevision += 1;
      assets := newAssets;
      capabilities := newCapabilities;
      reactions := newReactions;
      comments := newComments;
      roles := newRoles;
      bulkAccessPrincipals := newBulk;
      mediaEvidenceRevision += 1;
      galleryChatCards := newGalleryChatCards;
      albums := newAlbums;
    };
    #ok(changed)
  };
  public shared ({ caller }) func read_club_media_references(club : Text, offset : Nat, expected : ?Nat) : async { #Ok : MediaEvidence.Page; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before media inventory");
    switch (expected) { case (?r) { if (r != mediaEvidenceRevision) return #Err("Media inventory revision changed") }; case null { if (offset != 0) return #Err("Revision required after first page") } };
    let total = assets.size() + galleryChatCards.size();
    let (start, end) = MediaEvidence.bounds(offset, total);
    var refs : [MediaEvidence.Reference] = [];
    for (i in Nat.range(start, end)) { if (i < assets.size()) { let a = assets[i]; if (a.club_id == club) {
      let r = switch (a.blob_ref) { case (?b) { { resource_id = a.id; url = a.storage_path; store = ?b.canister; path = ?b.path; content_hash = ?b.content_hash } }; case null { { resource_id = a.id; url = a.storage_path; store = null; path = null; content_hash = null } } };
      refs := refs.concat([r]);
    } } else {
      let c = galleryChatCards[i - assets.size()]; if (c.club_id == club) {
        switch (c.hero_image_url) { case (?url) { refs := refs.concat([{ resource_id = "card:" # c.id; url; store = null; path = null; content_hash = null }]) }; case null {} };
      };
    } };
    #Ok({ revision = mediaEvidenceRevision; scanned = end - start; next = if (end < total) ?end else null; references = refs })
  };


  // Additive protected consensus reads; live UI rollout is a separate release gate.
  public shared ({ caller }) func read_account_get_asset(asset_id : Text) : async ?Types.Asset {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    for (a in assets.values()) {
      if (a.id == asset_id and not a.deleted and canView(caller, a)) return ?a;
    };
    null
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_assets(club_id : Text) : async [Types.Asset] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (caller.equal(Principal.anonymous())) return [];
    Array.filter<Types.Asset>(assets, func(a) {
      not a.deleted and hiddenGalleryAssets.get(a.id) != ?true and a.club_id == club_id and canView(caller, a)
    })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_reactions(asset_id : Text) : async [Types.Reaction] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id) { found := ?a } };
    switch (found) {
      case null { [] };
      case (?asset) {
        if (not canView(caller, asset)) return [];
        Array.filter<Types.Reaction>(reactions, func(r) = r.asset_id == asset_id)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_comments(asset_id : Text) : async [Types.Comment] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id) { found := ?a } };
    switch (found) {
      case null { [] };
      case (?asset) {
        if (not canView(caller, asset)) return [];
        Array.filter<Types.Comment>(comments, func(c) = c.asset_id == asset_id and not c.deleted)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_gallery_chat_card(card_id : Text) : async ?Types.GalleryChatCard {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    for (c in galleryChatCards.values()) {
      if (c.id == card_id and isClubMember(caller, c.club_id)) return ?c;
    };
    null
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_gallery_chat_cards(club_id : Text, team_id : Text) : async [Types.GalleryChatCard] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (caller.equal(Principal.anonymous()) or not isClubMember(caller, club_id)) return [];
    Array.filter<Types.GalleryChatCard>(galleryChatCards, func(c) = c.club_id == club_id and c.team_id == team_id)
  
    } finally { removalReceiver.leave(caller) };
  };
}
