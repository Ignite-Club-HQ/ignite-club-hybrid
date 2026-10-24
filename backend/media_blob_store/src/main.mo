import AccountAdmission "../../shared/AccountAdmission";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import Error "mo:core/Error";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Nat8 "mo:core/Nat8";
import Sha256 "mo:sha2/Sha256";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Timer "mo:core/Timer";
import UploadPolicy "uploadPolicy";
import AssembleChunks "assembleChunks";
import QuotaOperation "quotaOperation";
import StableBytes "stableBytes";
import MultiBytes "multiRegionBytes";
import RetentionPage "retentionPage";
import MediaRetentionPolicy "mediaRetentionPolicy";
import MediaByteAccounting "mediaByteAccounting";
import MediaInventory "mediaInventory";
import RetainedProtocol "retainedProtocol";
import RetainedQuota "../../club_domain/src/mediaRetainedQuota";

// media_blob_store — on-chain store for encrypted media bytes.
//
// This canister deliberately holds NO key material and does no crypto:
// clients IBE-encrypt media bytes in the browser (vetKeys, identity
// `path ++ U+001F ++ "blob"`) before uploading, and decrypt after
// downloading. Key custody and read authorization live on
// pii_access_control (one record per blob: pii_id = path, field_id =
// "blob", club-scoped read grants). http_request therefore serves only
// ciphertext — knowing a blob's URL yields nothing without the vetKey.
//
// The public contract is fixed in media_blob_store.did (the frontend
// uploader and migration script are written against it) — do not add or
// change methods here without updating that file and the bindings.
//
// --enhanced-migration: all actor state is seeded by the migration chain
// (bootstrap 20260913_000000). There is no initialize() in the fixed
// contract, so the governor principal is read from the GOVERNOR_PRINCIPAL
// canister environment variable at call time instead — the deploy script
// MUST set it (deployer principal) before first use.

persistent actor MediaBlobStore {
  // Local rehearsal only. Eligibility never grants resource permissions.
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
    if (Principal.isAnonymous(caller) or not isGovernor<system>(caller)) Runtime.trap("Governor required");
    [("club_domain", OpeningConfiguration.optional(club_domain_canister))]
  };
  // Live memory reading for the admin health page (public, like cycles_balance).
  public query func memory_stats() : async { heap_bytes : Nat; memory_bytes : Nat; stable_bytes : Nat } {
    {
      heap_bytes = PrimMem.rts_heap_size();
      memory_bytes = PrimMem.rts_memory_size();
      stable_bytes = PrimMem.nat64ToNat(PrimMem.stableMemorySize()) * 65536;
    }
  };


  // ==================== Types (mirror media_blob_store.did) ====================

  type HeaderField = (Text, Text);
  type HttpRequest = {
    url : Text;
    method : Text;
    headers : [HeaderField];
    body : Blob;
  };
  type HttpResponse = {
    status_code : Nat16;
    headers : [HeaderField];
    body : Blob;
    streaming_strategy : ?{ #Callback : { token : StreamToken; callback : shared query StreamToken -> async StreamResponse } };
  };
  type StreamToken = { path : Text; content_hash : Text; offset : Nat };
  type StreamResponse = { body : Blob; token : ?StreamToken };
  type StoredRecord = { path : Text; mime : Text; owner : Principal; content_hash : Text; slice : StableBytes.Slice; uploaded_at : Int };
  type Metadata = { path : Text; mime : Text; owner : Principal; content_hash : Text; length : Nat };
  type FinalizedBlob = {
    path : Text;
    content_hash : Text;
    content_length : Nat64;
  };
  type Health = {
    version : Text;
    blob_count : Nat64;
    total_bytes : Nat64;
  };
  type Result = { #Ok; #Err : Text };
  type ResultUploadId = { #Ok : Text; #Err : Text };
  type ResultFinalized = { #Ok : FinalizedBlob; #Err : Text };

  type BlobRecord = {
    path : Text;
    mime : Text;
    owner : Principal;
    bytes : Blob;
    content_hash : Text;
  };
  type PendingUpload = {
    id : Text;
    path : Text;
    mime : Text;
    owner : Principal;
    total_size : Nat64;
    chunk_count : Nat32;
    chunks : [?Blob];
  };

  // ==================== State (seeded by migration chain) ====================

  var blobs : [BlobRecord];
  var pending_uploads : [PendingUpload];
  var next_upload_seq : Nat64;
  // Principal of the club_domain canister used to verify club-staff delete
  // rights on clubs/<clubId>/ paths; set post-install via
  // set_club_domain_canister. While unset, only owner/governor may delete
  // (fail closed).
  var club_domain_canister : ?Principal;
  var vaultAuthority : ?Principal;
  // Sharding (migration 20261012): running byte total and capacity limit.
  var total_bytes : Nat64;
  var capacity_limit_bytes : Nat64;
  // Free-plan media caps (migration 20261014): per club, per 30-day cycle,
  // per category upload counters. Pro clubs (club_domain subscription) skip.
  var free_media_usage : [FreeUsageRow];
  // Retention (migration 20261015): upload time per blob path. Blobs without
  // a stamp are stamped on the next retention sweep (clock starts then).
  var blob_uploaded_at : [(Text, Int)];
  var quota_mode : { #local; #frozen; #sharedQuota };
  var quota_snapshot : [FreeUsageRow];
  var quota_operations : Map.Map<Text, QuotaOperation.Operation>;
  var stable_bytes : StableBytes.Store;
  var media_regions : Map.Map<Nat, StableBytes.Store>;
  transient let multi_bytes : MultiBytes.Store = { legacy = stable_bytes; regions = media_regions };
  transient let multiRegionRehearsal = Runtime.envVar<system>("IGNITE_MEDIA_MULTI_REGION_LOCAL_REHEARSAL") == ?"1";
  var stable_blobs : Map.Map<Text, StoredRecord>;
  var stable_writes : Bool;
  var upload_slots : Map.Map<Text, StableBytes.Slice>;
  transient let physicalReservationRehearsal = Runtime.envVar<system>("IGNITE_MEDIA_SLOT_LOCAL_REHEARSAL") == ?"1";
  var retention_cursor : Text;
  var legacy_retention_cursor : Nat;
  var media_inventory_revision : Nat;
  var media_transfer_fences : Map.Map<Text, Nat>;
  var retained_mode : { #local; #frozen; #active };
  var retained_snapshot_revision : Nat;
  var retained_revisions : Map.Map<Text, Nat>;
  var retained_deletions : Map.Map<Text, RetainedProtocol.Deletion>;
  var deletionHashes : Map.Map<Text, Text>;
  transient let retainedRehearsal = Runtime.envVar<system>("IGNITE_MEDIA_RETAINED_LOCAL_REHEARSAL") == ?"1";
  func retainedBlocked() : Bool { retained_mode == #frozen or (retained_mode == #active and not retainedRehearsal) };
  func pathMutationPending(path : Text) : Bool {
    if (pending_uploads.any(func upload = upload.path == path)) return true;
    if (retained_deletions.get(path) != null) return true;
    for ((_, op) in quota_operations.entries()) { if (op.path == path and op.status != #committed and op.status != #aborted) return true };
    false
  };
  type RetainedService = actor {
    read_media_retained_ready : shared () -> async Bool;
    reserve_retained_media : shared (Text, Text, Nat) -> async RetainedQuota.Result;
    commit_retained_media : shared Text -> async RetainedQuota.Result;
    cancel_retained_media : shared (Text, Text, Text, Nat) -> async RetainedQuota.Result;
    credit_deleted_retained_media : shared (Text, RetainedQuota.Object) -> async RetainedQuota.Result;
    prepare_deleted_retained_media : shared (Text, RetainedQuota.Object) -> async RetainedQuota.Result;
    acknowledge_retained_media : shared Text -> async Result;
  };
  func retainedService() : ?RetainedService { switch (club_domain_canister) { case (?id) ?(actor(id.toText()) : RetainedService); case null null } };


  func bumpInventory() { if (retained_mode != #frozen) media_inventory_revision += 1 };
  func mediaFenced(path : Text) : Bool {
    switch (clubIdFromPath(path)) { case (?club) media_transfer_fences.get(club) != null; case null false }
  };
  // Drain existing uploads via finalize/abort/reconcile; deny new writes and
  // deletions for this club. Fence survives upgrades and requires exact CAS.
  public shared ({ caller }) func set_club_media_transfer_fence(club : Text, on : Bool, expected : ?Nat) : async Result {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (club == "" or club.size() > 128 or club.contains(#char '/')) return #Err("Invalid club id");
    let current = media_transfer_fences.get(club);
    if (current != expected) return #Err("Media fence revision changed");
    if (on) {
      if (current == null) { bumpInventory(); media_transfer_fences.add(club, media_inventory_revision) }
    } else if (current != null) { media_transfer_fences.remove(club); bumpInventory() };
    #Ok
  };

  // Update rather than query: authenticated consensus evidence for operators.
  // Each call scans <=200 records, includes orphan blobs and unsettled journal
  // operations, and binds every page to one mutation revision. No bytes/PII.
  public shared ({ caller }) func club_media_inventory_page(club : Text, cursor : MediaInventory.Cursor, expected_revision : ?Nat) : async { #Ok : MediaInventory.Page; #Err : Text } {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (club == "" or club.size() > 128 or club.contains(#char '/')) return #Err("Invalid club id");
    switch (expected_revision) { case (?r) { if (r != media_inventory_revision) return #Err("Media inventory changed; restart scan") }; case null {} };
    if (cursor.after.size() > 1_024) return #Err("Invalid media cursor");
    switch (cursor.phase) {
      case (#legacy) { if (cursor.after != "" or cursor.offset > blobs.size()) return #Err("Invalid legacy cursor") };
      case (#pending) { if (cursor.after != "" or cursor.offset > pending_uploads.size()) return #Err("Invalid pending cursor") };
      case (#indexed) { if (cursor.offset != 0) return #Err("Invalid indexed cursor") };
      case (#journal) { if (cursor.offset != 0) return #Err("Invalid journal cursor") };
      case (#done) { if (cursor.offset != 0 or cursor.after != "") return #Err("Invalid terminal cursor") }
    };
    var entries : [MediaInventory.Entry] = [];
    var scanned = 0;
    var next : ?MediaInventory.Cursor = null;
    func add(path : Text, kind : { #blob; #pending; #journal }, id : Text, hash : Text, length : Nat, unsettled : Bool) {
      if (clubIdFromPath(path) == ?club) entries := entries.concat([{ kind; path; upload_id = id; content_hash = hash; content_length = length; unsettled }])
    };
    switch (cursor.phase) {
      case (#legacy) {
        var offset = cursor.offset;
        while (offset < blobs.size() and scanned < MediaInventory.pageLimit) {
          let r = blobs[offset]; add(r.path, #blob, "", r.content_hash, r.bytes.size(), false);
          offset += 1; scanned += 1
        };
        next := if (offset < blobs.size()) ?{ phase = #legacy; offset; after = "" } else ?{ phase = #indexed; offset = 0; after = "" }
      };
      case (#indexed) {
        var after = cursor.after;
        for ((path, r) in stable_blobs.entriesFrom(cursor.after)) {
          if (path == cursor.after and cursor.after != "") continue;
          if (scanned >= MediaInventory.pageLimit) break;
          add(path, #blob, "", r.content_hash, r.slice.length, false); after := path; scanned += 1
        };
        next := if (scanned == MediaInventory.pageLimit) ?{ phase = #indexed; offset = 0; after } else ?{ phase = #pending; offset = 0; after = "" }
      };
      case (#pending) {
        var offset = cursor.offset;
        while (offset < pending_uploads.size() and scanned < MediaInventory.pageLimit) {
          let r = pending_uploads[offset]; add(r.path, #pending, r.id, "", r.total_size.toNat(), true);
          offset += 1; scanned += 1
        };
        next := if (offset < pending_uploads.size()) ?{ phase = #pending; offset; after = "" } else ?{ phase = #journal; offset = 0; after = "" }
      };
      case (#journal) {
        var after = cursor.after;
        for ((id, r) in quota_operations.entriesFrom(cursor.after)) {
          if (id == cursor.after and cursor.after != "") continue;
          if (scanned >= MediaInventory.pageLimit) break;
          let unsettled = r.status != #committed and r.status != #aborted;
          if (unsettled) add(r.path, #journal, id, "", r.bytes, true);
          after := id; scanned += 1
        };
        next := if (scanned == MediaInventory.pageLimit) ?{ phase = #journal; offset = 0; after } else ?{ phase = #done; offset = 0; after = "" }
      };
      case (#done) {}
    };
    #Ok({ revision = media_inventory_revision; fenced = media_transfer_fences.get(club) != null;
      fence_revision = media_transfer_fences.get(club); quota_shared = quota_mode == #sharedQuota;
      quota_authority = club_domain_canister; entries; next; scanned })
  };

  type QuotaReservation = { store : Principal; token : Text; club_id : Text; category : Text; cycle : Nat; bytes : Nat; status : { #reserved; #committed; #released } };
  type QuotaResult = { #Ok : QuotaReservation; #Err : Text };
  type QuotaService = actor {
    media_quota_ready : shared query () -> async Bool;
    reserve_media_quota : shared (Text, Text, Text, Nat, Nat) -> async QuotaResult;
    commit_media_quota : shared Text -> async QuotaResult;
    cancel_media_quota : shared (Text, Text, Text, Nat, Nat) -> async QuotaResult;
  };
  func quotaService() : ?QuotaService {
    switch (club_domain_canister) { case (?id) { ?(actor(id.toText()) : QuotaService) }; case null null }
  };

  // Freeze the entire store, not a filtered club inventory. Snapshot pages
  // are direct consensus reads; no operator-supplied byte totals are accepted.
  public shared ({ caller }) func freeze_retained_media() : async Result {
    if (not isGovernor<system>(caller) or not retainedRehearsal) return #Err("Local retained rehearsal governor required");
    if (retained_mode == #frozen) return #Ok;
    if (retained_mode != #local or quota_mode != #frozen or pending_uploads.size() != 0 or retained_deletions.size() != 0) return #Err("Freeze monthly quota and drain mutations first");
    for ((_, op) in quota_operations.entries()) { if (op.status != #committed and op.status != #aborted) return #Err("Unsettled upload journal") };
    for ((_, active) in removal_active.entries()) { if (active != 0) return #Err("In-flight media operation") };
    retained_mode := #frozen; retained_snapshot_revision := media_inventory_revision; #Ok
  };
  public shared ({ caller }) func retained_snapshot_page(cursor : RetainedProtocol.Cursor) : async RetainedProtocol.Page {
    if (?caller != club_domain_canister and not isGovernor<system>(caller)) Runtime.trap("Retained authority required");
    if (retained_mode != #frozen or media_inventory_revision != retained_snapshot_revision) Runtime.trap("Frozen retained snapshot required");
    if (cursor.after.size() > 512) Runtime.trap("Invalid cursor");
    var rows : [RetainedProtocol.Row] = [];
    var next : RetainedProtocol.Cursor = { phase = #done; offset = 0; after = "" };
    func add(path : Text, bytes : Nat, hash : Text) {
      rows := rows.concat([{ path; bytes; club = RetainedProtocol.club(path); content_hash = hash; revision = retained_revisions.get(path) ?? 0 }])
    };
    switch (cursor.phase) {
      case (#legacy) {
        if (cursor.after != "" or cursor.offset > blobs.size()) Runtime.trap("Invalid legacy cursor");
        var offset = cursor.offset;
        while (offset < blobs.size() and rows.size() < 200) { let row = blobs[offset]; add(row.path, row.bytes.size(), row.content_hash); offset += 1 };
        next := if (offset < blobs.size()) ({ phase = #legacy; offset; after = "" }) else ({ phase = #indexed; offset = 0; after = "" })
      };
      case (#indexed) {
        if (cursor.offset != 0) Runtime.trap("Invalid indexed cursor");
        var after = cursor.after;
        for ((path, row) in stable_blobs.entriesFrom(cursor.after)) {
          if (path == cursor.after and cursor.after != "") continue;
          if (rows.size() >= 200) break;
          add(path, row.slice.length, row.content_hash); after := path
        };
        if (rows.size() == 200) next := { phase = #indexed; offset = 0; after }
      };
      case (#done) Runtime.trap("Terminal cursor has no page")
    };
    { frozen = true; pending = pending_uploads.size() + retained_deletions.size(); authority = club_domain_canister; revision = retained_snapshot_revision; total = blobs.size() + stable_blobs.size(); total_bytes = total_bytes.toNat(); cursor; next; rows }
  };
  public shared ({ caller }) func enable_retained_media_quota() : async Result {
    if (not isGovernor<system>(caller) or not retainedRehearsal) return #Err("Local retained rehearsal governor required");
    if (retained_mode == #active) return #Ok;
    if (retained_mode != #frozen or quota_mode != #sharedQuota) return #Err("Frozen baseline and shared monthly quota required");
    let ?service = retainedService() else return #Err("Retained authority unset");
    let authority = club_domain_canister;
    try {
      if (not (await (with timeout = 10) service.read_media_retained_ready())) return #Err("All-store retained baseline inactive");
      if (club_domain_canister != authority or retained_mode != #frozen or media_inventory_revision != retained_snapshot_revision) return #Err("Snapshot changed");
      retained_mode := #active; bumpInventory(); #Ok
    } catch (_) { #Err("Retained authority unavailable") }
  };
  func creditDeletion(path : Text) : async Result {
    let ?original = retained_deletions.get(path) else return #Ok;
    if (not retainedRehearsal or retained_mode != #active) return #Err("Retained accounting unavailable");
    let ?service = retainedService() else return #Err("Retained authority unset");
    let authority = club_domain_canister;
    let entry : RetainedQuota.Object = { store = Principal.fromActor(MediaBlobStore); path; club = original.club; bytes = original.bytes; revision = original.revision };
    try {
      if (not original.removed) {
        switch (await (with timeout = 10) service.prepare_deleted_retained_media(original.token, entry)) {
          case (#Err(message)) {
            if (message == "Expired retained token absent") {
              switch (retained_deletions.get(path)) { case (?current) { if (current.token == original.token and not current.removed) retained_deletions.remove(path) }; case null {} }
            };
            return #Err(message)
          };
          case (#Ok(op)) { if (op.state != #reserved) return #Err("Deletion preparation conflict") }
        };
        if (authority != club_domain_canister or retainedBlocked() or mediaFenced(path)) return #Err("Deletion authority changed or fenced");
        let ?latest = retained_deletions.get(path) else return #Ok;
        if (not latest.removed) {
          if (latest.token != original.token or (retained_revisions.get(path) ?? 0) != original.revision) return #Err("Deletion revision changed");
          let ?record = metadata(path) else return #Err("Deletion object unavailable");
          if (record.length != original.bytes or record.owner != original.owner) return #Err("Deletion object changed");
          switch (deletionHashes.get(path)) { case (?hash) { if (record.content_hash != hash) return #Err("Deletion hash changed") }; case null return #Err("Legacy deletion requires hash reconciliation") };
          retained_deletions.add(path, { latest with removed = true }); removeStored(path)
        }
      };
      switch (await (with timeout = 10) service.credit_deleted_retained_media(original.token, entry)) {
        case (#Err(message)) {
          if (message == "Expired retained token absent" and original.removed) {
            switch (await service.acknowledge_retained_media(original.token)) {
              case (#Ok) { switch (retained_deletions.get(path)) { case (?current) { if (current.token == original.token and current.removed) retained_deletions.remove(path) }; case null {} }; #Ok };
              case (#Err(error)) #Err(error)
            }
          } else #Err(message)
        };
        case (#Ok(op)) {
          if (op.state != #committed or authority != club_domain_canister) return #Err("Deletion receipt changed");
          switch (retained_deletions.get(path)) {
            case null #Ok;
            case (?latest) {
              if (latest.token != original.token or not latest.removed) return #Err("Deletion receipt changed");
              if (original.token.startsWith(#text "r1:")) { switch (await (with timeout = 10) service.acknowledge_retained_media(original.token)) { case (#Err(message)) return #Err(message); case (#Ok) {} } };
              switch (retained_deletions.get(path)) { case (?current) { if (current.token == original.token) retained_deletions.remove(path) }; case null {} };
              bumpInventory(); #Ok
            }
          }
        }
      }
    } catch (_) { #Err("Deletion outcome unknown; retry same path") }
  };
  // Physical deletion + receipt are atomic. The path remains locked until
  // exact-revision credit is acknowledged, including after an upgrade.
  func deleteRetained(path : Text) : async Result {
    if (retainedBlocked()) return #Err("Retained store frozen or unavailable");
    if (retained_deletions.get(path) != null) return await creditDeletion(path);
    if (pathMutationPending(path)) return #Err("Upload mutation pending; retry delete after settlement");
    if (retained_mode != #active or RetainedProtocol.club(path) == null) { removeStored(path); return #Ok };
    let ?record = metadata(path) else return #Err("Unknown blob");
    let ?club = RetainedProtocol.club(path) else return #Err("Club path required");
    if (retained_deletions.size() >= 100_000) return #Err("Deletion ledger full");
    next_upload_seq += 1;
    let receipt : RetainedProtocol.Deletion = { token = "r1:" # currentCycle().toText() # ":" # next_upload_seq.toText() # ":delete"; path; club; bytes = record.length; revision = retained_revisions.get(path) ?? 0; owner = record.owner; removed = false };
    retained_deletions.add(path, receipt);
    deletionHashes.add(path, record.content_hash);
    await creditDeletion(path)
  };
  public shared ({ caller }) func reconcile_retained_deletions(cursor : Text) : async { #Ok : { cursor : Text; attempted : Nat }; #Err : Text } {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    var paths : [Text] = [];
    for ((path, _) in retained_deletions.entriesFrom(cursor)) { if (path == cursor and cursor != "") continue; if (paths.size() >= 20) break; paths := paths.concat([path]) };
    for (path in paths.values()) { ignore await creditDeletion(path) };
    #Ok({ cursor = if (paths.size() == 20) paths[19] else ""; attempted = paths.size() })
  };

  // Upload ownership alone is not club authorization. Re-evaluate the
  // original human against the owning club before each upload mutation.
  func requireUploadMembership(user : Principal, path : Text) : async () {
    let ?club = clubIdFromPath(path) else return;
    if (isGovernor<system>(user)) return;
    let ?authority = club_domain_canister else throw Error.reject("Club upload authority unavailable");
    let service : actor { read_has_club_membership : shared (Principal, Text) -> async Bool } = actor(authority.toText());
    let member = try { await (with timeout = 10) service.read_has_club_membership(user, club) } catch (_) { false };
    if (removalReceiver.denied(user) or mediaFenced(path)) throw Error.reject("Upload authorization fenced");
    if (club_domain_canister != ?authority or not member) throw Error.reject("Club membership required for upload");
  };

  // Commit-time variant: enforces membership and removal denial but not the
  // media-transfer fence, so fenced stores can still settle in-flight commits.
  func requireUploadMembershipForCommit(user : Principal, path : Text) : async () {
    let ?club = clubIdFromPath(path) else return;
    if (isGovernor<system>(user)) return;
    let ?authority = club_domain_canister else throw Error.reject("Club upload authority unavailable");
    let service : actor { read_has_club_membership : shared (Principal, Text) -> async Bool } = actor(authority.toText());
    let member = try { await (with timeout = 10) service.read_has_club_membership(user, club) } catch (_) { false };
    if (removalReceiver.denied(user)) throw Error.reject("Account removal fenced");
    if (club_domain_canister != ?authority or not member) throw Error.reject("Club membership required for upload");
  };

  // Freeze is irreversible to local enforcement. Reads remain available.
  // No upload can slip past a subscription await: begin rechecks this mode.
  public shared ({ caller }) func freeze_media_quota() : async Result {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (quota_mode == #sharedQuota) return #Err("Shared quota already active");
    if (quota_mode == #frozen) return #Ok;
    if (pending_uploads.size() != 0) return #Err("Finalize or abort pending uploads first");
    quota_snapshot := free_media_usage;
    quota_mode := #frozen;
    #Ok
  };
  public shared ({ caller }) func quota_snapshot_page(offset : Nat) : async { frozen : Bool; pending : Nat; total : Nat; offset : Nat; rows : [FreeUsageRow] } {
    if (?caller != club_domain_canister and not isGovernor<system>(caller)) Runtime.trap("Quota authority required");
    let count = if (offset >= quota_snapshot.size()) 0 else Nat.min(200, quota_snapshot.size() - offset);
    { frozen = quota_mode == #frozen; pending = pending_uploads.size(); total = quota_snapshot.size(); offset; rows = Array.tabulate<FreeUsageRow>(count, func(i) = quota_snapshot[offset + i]) }
  };
  public shared ({ caller }) func enable_shared_media_quota() : async Result {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (quota_mode == #sharedQuota) return #Ok;
    if (quota_mode != #frozen) return #Err("Freeze and import this store first");
    let ?service = quotaService() else return #Err("Quota authority unset");
    try {
      if (not (await service.media_quota_ready())) return #Err("All-store quota import not activated");
      quota_mode := #sharedQuota;
      if (retained_mode != #frozen) bumpInventory();
      #Ok
    } catch (_) { #Err("Quota authority unavailable") }
  };
  public query ({ caller }) func get_upload_outcome(upload_id : Text) : async { #Ok : ?FinalizedBlob; #Err : Text } {
    denyLegacyAccountQuery();
    switch (quota_operations.get(upload_id)) {
      case (?op) {
        if (not op.owner.equal(caller)) return #Err("Not the upload owner");
        if (op.status == #committed) #Ok(op.result) else #Err("Upload not committed; retry finalize or abort")
      };
      case null #Err("Unknown upload")
    }
  };
  public shared ({ caller }) func retire_upload_outcomes(cursor : Text) : async { #Ok : { removed : Nat; cursor : Text }; #Err : Text } {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    bumpInventory();
    var removed = 0;
    var scanned = 0;
    var next = "";
    var deletes : [Text] = [];
    for ((id, op) in quota_operations.entriesFrom(cursor)) {
      if (id == cursor and cursor != "") continue;
      if (scanned >= 200) break;
      scanned += 1; next := id;
      if (op.cycle + 1 < currentCycle() and (op.status == #committed or op.status == #aborted)) {
        deletes := deletes.concat([id]); removed += 1
      }
    };
    removed := 0;
    for (id in deletes.values()) {
      var permitted = retained_mode != #active or id.startsWith(#text "upload-");
      if (retained_mode == #active and id.startsWith(#text "r1:")) {
        switch (retainedService()) {
          case (?retained) { try { switch (await retained.acknowledge_retained_media(id)) { case (#Ok) permitted := true; case _ {} } } catch (_) {} };
          case null {}
        }
      };
      if (permitted) { quota_operations.remove(id); removed += 1 }
    };
    if (scanned < 200) next := "";
    #Ok({ removed; cursor = next })
  };
  public shared ({ caller }) func reconcile_upload_operations(cursor : Text) : async { #Ok : { cursor : Text; attempted : Nat }; #Err : Text } {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    // Materialize at most 20 IDs before yielding; never retain a mutable-map
    // iterator across awaits. Unknown commits/releases retry the same token.
    var ids : [Text] = [];
    for ((id, _) in quota_operations.entriesFrom(cursor)) {
      if (id == cursor and cursor != "") continue;
      if (ids.size() >= 20) break;
      ids := ids.concat([id])
    };
    var attempted = 0;
    for (id in ids.values()) {
      switch (quota_operations.get(id)) {
        case (?op) {
          if (retained_mode == #active and (op.status == #committed or op.status == #aborted) and id.startsWith(#text "r1:")) {
            switch (retainedService()) { case (?retained) { ignore await retained.acknowledge_retained_media(id); attempted += 1 }; case null {} }
          };
          if (op.status == #committing) { ignore await commitShared(id); attempted += 1 };
          if (op.status == #aborting) { ignore await abortShared(id); attempted += 1 };
          if (op.status == #reserving) {
            switch (findUpload(id)) { case (?upload) { ignore await reserveShared(upload); attempted += 1 }; case null {} }
          }
        };
        case null {}
      }
    };
    #Ok({ cursor = if (ids.size() == 20) ids[19] else ""; attempted })
  };

  func reserveShared(upload : PendingUpload) : async ResultUploadId {
    bumpInventory();
    let ?op = quota_operations.get(upload.id) else return #Err("Missing quota journal");
    if (op.status == #uploading) return #Ok(upload.id);
    if (op.status != #reserving) return #Err("Upload cannot be resumed");
    let ?service = quotaService() else return #Err("Quota authority unset; retry begin");
    try {
      if (removalReceiver.denied(upload.owner)) { ignore await abortShared(upload.id); return #Err("Account removal fenced") };
      let authority = club_domain_canister;
      if (retained_mode == #active) {
        if (not retainedRehearsal) return #Err("Retained accounting unavailable");
        let ?retained = retainedService() else return #Err("Retained authority unset");
        switch (await (with timeout = 10) retained.reserve_retained_media(upload.id, op.path, op.bytes)) {
          case (#Ok(r)) { if (r.state != #reserved) return #Err("Retained reservation settled") };
          case (#Err(message)) { ignore await abortShared(upload.id); return #Err(message) }
        };
        if (authority != club_domain_canister) return #Err("Retained authority changed")
      };
      let result : QuotaResult = if (op.category == "branding") #Ok({ store = Principal.fromActor(MediaBlobStore); token = upload.id; club_id = op.club_id; category = op.category; bytes = op.bytes; cycle = op.cycle; status = #reserved }) else await (with timeout = 10) service.reserve_media_quota(upload.id, op.club_id, op.category, op.bytes, op.cycle);
      if (removalReceiver.denied(upload.owner)) { ignore await abortShared(upload.id); return #Err("Account removal fenced") };
      try { await requireUploadMembership(upload.owner, upload.path) } catch (_) {
        ignore await abortShared(upload.id); return #Err("Club membership changed")
      };
      bumpInventory();
      // Concurrent abort/finalize must never be overwritten by a callback.
      let ?latest = quota_operations.get(upload.id) else return #Err("Missing quota journal");
      if (latest.status == #uploading) return #Ok(upload.id);
      if (latest.status != #reserving) return #Err("Upload cancelled or settled");
      switch (result) {
        case (#Ok(r)) {
          if (r.status != #reserved) return #Err("Reservation already settled");
          quota_operations.add(upload.id, { latest with status = #uploading });
          #Ok(upload.id)
        };
        case (#Err(message)) {
          // Another identical request can still be in flight. Create a
          // cancellation tombstone before discarding any local reservation.
          ignore await abortShared(upload.id);
          #Err(message)
        }
      }
    } catch (_) { #Err("Quota reservation outcome unknown; retry same upload path") }
  };
  func commitShared(id : Text) : async ResultFinalized {
    bumpInventory();
    let ?op = quota_operations.get(id) else return #Err("Unknown upload");
    if (op.status == #committed) { let ?result = op.result else return #Err("Missing result"); return #Ok(result) };
    if (op.status != #committing) return #Err("Upload not ready to commit");
    let ?service = quotaService() else return #Err("Quota authority unset; retry finalize");
    // Membership is checked here, after finalize's atomic local write: an
    // unreachable authority must leave the ciphertext stored but unpublished.
    try { await requireUploadMembershipForCommit(op.owner, op.path) } catch (e) { return #Err(Error.message(e)) };
    try {
      if (retained_mode == #active) {
        if (not retainedRehearsal) return #Err("Retained accounting unavailable");
        let ?retained = retainedService() else return #Err("Retained authority unset");
        switch (await (with timeout = 10) retained.commit_retained_media(id)) {
          case (#Ok(r)) { if (r.state != #committed) return #Err("Retained commit unsettled") };
          case (#Err(message)) return #Err(message)
        }
      };
      let monthly : QuotaResult = if (op.category == "branding") #Ok({ store = Principal.fromActor(MediaBlobStore); token = id; club_id = op.club_id; category = op.category; bytes = op.bytes; cycle = op.cycle; status = #committed }) else await (with timeout = 10) service.commit_media_quota(id);
      switch (monthly) {
        case (#Ok(r)) {
          bumpInventory();
          if (r.status != #committed) return #Err("Quota not committed");
          let ?latest = quota_operations.get(id) else return #Err("Missing quota journal");
          let ?result = latest.result else return #Err("Missing result");
          quota_operations.add(id, { latest with status = #committed });
          if (retained_mode == #active) { switch (retainedService()) { case (?retained) { ignore await retained.acknowledge_retained_media(id) }; case null {} } };
          #Ok(result)
        };
        case (#Err(message)) #Err(message)
      }
    } catch (_) { #Err("Quota commit outcome unknown; retry finalize, do not abort") }
  };
  func abortShared(id : Text) : async Result {
    bumpInventory();
    let ?op = quota_operations.get(id) else return #Err("Unknown upload");
    if (op.status == #aborted) return #Ok;
    if (not QuotaOperation.canAbort(op)) return #Err("Already finalized; retry finalize");
    quota_operations.add(id, { op with status = #aborting });
    let ?service = quotaService() else {
      // Leave the upload retryable: an unset authority must not dead-end it.
      let ?latest = quota_operations.get(id) else return #Err("Missing quota journal");
      if (latest.status == #aborting and retained_mode != #active) quota_operations.add(id, { latest with status = #uploading });
      return #Err("Quota authority unset; retry abort")
    };
    try {
      if (retained_mode == #active) {
        if (not retainedRehearsal) return #Err("Retained accounting unavailable");
        let ?retained = retainedService() else return #Err("Retained authority unset");
        switch (await (with timeout = 10) retained.cancel_retained_media(id, op.club_id, op.path, op.bytes)) {
          case (#Ok(r)) { if (r.state != #released) return #Err("Retained release unsettled") };
          case (#Err(message)) return #Err(message)
        }
      };
      let monthly : QuotaResult = if (op.category == "branding") #Ok({ store = Principal.fromActor(MediaBlobStore); token = id; club_id = op.club_id; category = op.category; bytes = op.bytes; cycle = op.cycle; status = #released }) else await (with timeout = 10) service.cancel_media_quota(id, op.club_id, op.category, op.bytes, op.cycle);
      switch (monthly) {
        case (#Ok(r)) {
          bumpInventory();
          if (r.status != #released) return #Err("Reservation not released");
          let ?latest = quota_operations.get(id) else return #Err("Missing quota journal");
          quota_operations.add(id, { latest with status = #aborted });
          releaseUploadSlot(id);
          pending_uploads := pending_uploads.filter(func(u) = u.id != id);
          if (retained_mode == #active) { switch (retainedService()) { case (?retained) { ignore await retained.acknowledge_retained_media(id) }; case null {} } };
          #Ok
        };
        case (#Err(message)) #Err(message)
      }
    } catch (_) {
      // Unknown outcome: the reservation may or may not be released. Keep the
      // upload retryable instead of dead-ending it in #aborting.
      let ?latest = quota_operations.get(id) else return #Err("Missing quota journal");
      if (latest.status == #aborting and retained_mode != #active) quota_operations.add(id, { latest with status = #uploading });
      #Err("Quota release outcome unknown; retry abort")
    }
  };

  type FreeUsageRow = { club_id : Text; cycle : Nat; category : Text; count : Nat; bytes : Nat64 };
  type MediaUsage = { category : Text; count : Nat; bytes : Nat64; count_limit : Nat; bytes_limit : ?Nat64 };

  // ==================== Free-plan caps ====================
  // Mirrors the Supabase free tier (useClubFreeUsage constants).
  transient let CYCLE_NS : Nat = 30 * 86_400 * 1_000_000_000;
  transient let FREE_FILE_BYTES : Nat64 = 26_214_400; // 25 MB

  func currentCycle() : Nat { Int.abs(Time.now()) / CYCLE_NS };

  func pathSegments(path : Text) : [Text] { Iter.toArray(Text.split(path, #char '/')) };

  /// null = not capped (non-club path or exempt branding asset).
  func categoryForPath(path : Text) : ?Text {
    let segs = pathSegments(path);
    if (segs.size() < 3 or segs[0] != "clubs") return null;
    let exempt = ["logos", "sponsors", "rewards", "qr-codes", "points-icon"];
    for (seg in segs.values()) {
      if (exempt.any(func(e) { e == seg })) return null;
    };
    if (segs[2] == "vault") return ?"vault";
    var inChat = false;
    var prev = "";
    for (seg in segs.values()) {
      if (prev == "chat" and seg == "files") return ?"chat_file";
      if (seg == "chat" or seg == "scheduled") inChat := true;
      prev := seg;
    };
    if (inChat) ?"chat_photo" else ?"gallery_photo"
  };

  // Per-file cap for gallery/chat photos (all clubs) and free-club files.
  transient let MAX_FILE_BYTES : Nat64 = UploadPolicy.maxWireBytes; // encrypted 10 MiB + framing
  // Free clubs keep uploaded media for 6 months; Pro/trial keep forever.
  transient let RETENTION_NS : Int = 180 * 86_400 * 1_000_000_000;

  func limitsFor(category : Text) : (Nat, ?Nat64) {
    if (category == "vault" or category == "chat_file") (10, ?FREE_FILE_BYTES) else (10, null)
  };

  func usageFor(clubId : Text, cycle : Nat, category : Text) : (Nat, Nat64) {
    switch (Array.find<FreeUsageRow>(free_media_usage, func(r) { r.club_id == clubId and r.cycle == cycle and r.category == category })) {
      case (?r) { (r.count, r.bytes) };
      case null { (0, 0) };
    }
  };

  func recordUsage(clubId : Text, category : Text, size : Nat64) {
    let cycle = currentCycle();
    let (count, bytes) = usageFor(clubId, cycle, category);
    let kept = free_media_usage.filter(func(r) {
      r.cycle == cycle and not (r.club_id == clubId and r.category == category)
    });
    free_media_usage := kept.concat([{ club_id = clubId; cycle; category; count = count + 1; bytes = bytes + size }]);
  };

  type Allowance = { limit_bytes : Nat; base_bytes : Nat; team_scoped : Bool; premium : Bool };
  func mediaTeam(path : Text) : ?Text {
    let segs = pathSegments(path);
    if (segs.size() >= 5 and segs[2] == "teams") return ?segs[3];
    if (segs.size() >= 6 and segs[2] == "vault" and segs[3] == "teams") return ?segs[4];
    null
  };
  func pathAllowance(path : Text) : async ?Allowance {
    let ?club = clubIdFromPath(path) else return null;
    let ?cid = club_domain_canister else return null;
    let domain : actor { get_media_allowance : shared query (Text, ?Text) -> async { #Ok : Allowance; #Err : Text } } = actor(cid.toText());
    try { switch (await domain.get_media_allowance(club, mediaTeam(path))) { case (#Ok(a)) ?a; case _ null } } catch (_) { null }
  };

  /// Returns an error message when a free club is over its cap.
  func checkFreeCap(path : Text, size : Nat64, isPro : Bool) : ?Text {
    let ?category = categoryForPath(path) else return null;
    let ?clubId = clubIdFromPath(path) else return null;
    let (countLimit, bytesLimit) = limitsFor(category);
    if (size > MAX_FILE_BYTES) {
      if (category == "gallery_photo" or category == "chat_photo") return ?"FileTooLarge";
      if (not isPro) return ?"FileTooLarge";
    };
    let (count, bytes) = usageFor(clubId, currentCycle(), category);
    var pendingCount = 0;
    var pendingBytes : Nat = 0;
    for (upload in pending_uploads.values()) {
      if (clubIdFromPath(upload.path) == ?clubId and categoryForPath(upload.path) == ?category) {
        pendingCount += 1;
        pendingBytes += upload.total_size.toNat();
      };
    };
    if (UploadPolicy.withinFreeQuota(count, bytes.toNat(), pendingCount, pendingBytes, size.toNat(), countLimit, bytesLimit)) return null;
    if (isPro) return null;
    ?("FreeLimitReached:" # category)
  };

  public query func get_club_media_usage(club_id : Text) : async [MediaUsage] {
    let cycle = currentCycle();
    ["gallery_photo", "chat_photo", "chat_file", "vault"].map(func(category) {
      let (count, bytes) = usageFor(club_id, cycle, category);
      let (count_limit, bytes_limit) = limitsFor(category);
      { category; count; bytes; count_limit; bytes_limit }
    })
  };

  // ==================== Helpers ====================

  // Larger capacity is opt-in per store and only for stable-backed writes.
  transient let largeCapacityFlag = Runtime.envVar<system>("IGNITE_MEDIA_LARGE_CAPACITY") == ?"1";
  func largeMode() : Bool { largeCapacityFlag and stable_writes };
  // Extra Regions are production storage in large mode (200 GiB policy).
  func multiRegionWrites() : Bool { multiRegionRehearsal or largeMode() };

  /// Finalized + in-flight gallery, vault and chat bytes. Branding is exempt.
  func scopedMediaBytes(clubId : Text, teamId : ?Text) : (Nat, Nat) {
    let prefix = "clubs/" # clubId # "/";
    var used = 0;
    label scan for ((path, r) in stable_blobs.entriesFrom(prefix)) {
      if (not path.startsWith(#text prefix)) break scan;
      if (categoryForPath(path) != null and (teamId == null or mediaTeam(path) == teamId)) used += MediaByteAccounting.storedBytes(MultiBytes.read(multi_bytes, r.slice, 0, 8), r.slice.length)
    };
    for (r in blobs.values()) { if (r.path.startsWith(#text prefix) and stable_blobs.get(r.path) == null and categoryForPath(r.path) != null and (teamId == null or mediaTeam(r.path) == teamId)) used += MediaByteAccounting.storedBytes(r.bytes, r.bytes.size()) };
    var pending = 0;
    for (u in pending_uploads.values()) { if (u.path.startsWith(#text prefix) and categoryForPath(u.path) != null and (teamId == null or mediaTeam(u.path) == teamId)) pending += MediaByteAccounting.pendingBytes(u.total_size.toNat()) };
    (used, pending)
  };

  func clubMediaBytes(clubId : Text) : (Nat, Nat) { scopedMediaBytes(clubId, null) };

  func clubMediaPurchasedGb(clubId : Text) : async ?Nat {
    let ?cid = club_domain_canister else return null;
    let clubDomain : actor { get_club_storage_purchased : shared query Text -> async { #Ok : Nat32; #Err : Text } } = actor (Principal.toText(cid));
    try {
      switch (await clubDomain.get_club_storage_purchased(clubId)) { case (#Ok(gb)) ?gb.toNat(); case (#Err(_)) null }
    } catch (_) { null }
  };

  /// Authoritative per-club media byte count for the Pro allowance UI: the
  /// same finalized + in-flight figures the admission check enforces.
  public query func get_club_media_bytes(club_id : Text) : async { finalized : Nat; pending : Nat } {
    let (finalized, pending) = clubMediaBytes(club_id);
    { finalized; pending }
  };

  func reservedBytes() : Nat {
    var total = 0;
    for (upload in pending_uploads.values()) { total += upload.total_size.toNat() };
    total
  };

  func canReserve(size : Nat64) : Bool {
    UploadPolicy.canAdmitWithCeiling(capacity_limit_bytes, total_bytes, reservedBytes(), size, PrimMem.rts_heap_size(), mediaCapacityCeiling()) and
    // Removing the local flag with pending extents must fail closed, not
    // silently allocate a second slice for an already reserved upload.
    (physicalReservationRehearsal or upload_slots.size() == 0) and
    (not stable_writes or (stable_blobs.size() + pending_uploads.size() < UploadPolicy.maxStoredFiles and MultiBytes.canAllocateWithin(multi_bytes, size.toNat(), capacity_limit_bytes.toNat(), multiRegionWrites())))
  };
  func releaseUploadSlot(id : Text) {
    switch (upload_slots.get(id)) {
      case (?slice) { upload_slots.remove(id); MultiBytes.release(multi_bytes, slice) };
      case null {}
    }
  };

  func storedChunkBytes(upload : PendingUpload) : Nat {
    var total = 0;
    for (chunk in upload.chunks.values()) { switch (chunk) { case (?bytes) { total += bytes.size() }; case null {} } };
    total
  };

  func subBytes(total : Nat64, size : Nat) : Nat64 {
    let s = Nat.toNat64(size);
    if (s > total) 0 else total - s
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Anonymous callers not allowed");
  };

  // Governor comes from an environment variable because the fixed contract
  // has no initialize(). Read per call (system capability is only available
  // inside shared methods); unset means "no governor" (fail closed).
  func governorPrincipal<system>() : ?Principal {
    switch (Runtime.envVar<system>("GOVERNOR_PRINCIPAL")) {
      case (?text) { ?Principal.fromText(text) };
      case null { null };
    }
  };

  func isGovernor<system>(caller : Principal) : Bool {
    switch (governorPrincipal<system>()) {
      case (?governor) { caller.equal(governor) };
      case null { false };
    }
  };

  func findBlob(path : Text) : ?BlobRecord {
    Array.find<BlobRecord>(blobs, func(record) { record.path == path })
  };
  func metadata(path : Text) : ?Metadata {
    switch (stable_blobs.get(path)) {
      case (?r) ?{ path = r.path; mime = r.mime; owner = r.owner; content_hash = r.content_hash; length = r.slice.length };
      case null { switch (findBlob(path)) { case (?r) ?{ path = r.path; mime = r.mime; owner = r.owner; content_hash = r.content_hash; length = r.bytes.size() }; case null null } }
    }
  };
  func readRange(path : Text, offset : Nat) : Blob {
    switch (stable_blobs.get(path)) {
      case (?r) MultiBytes.read(multi_bytes, r.slice, offset, StableBytes.responseChunk);
      case null {
        switch (findBlob(path)) {
          case (?r) {
            if (offset >= r.bytes.size()) return "";
            let bytes = r.bytes.toArray();
            Blob.fromArray(Array.tabulate<Nat8>(Nat.min(StableBytes.responseChunk, bytes.size() - offset), func(i) = bytes[offset + i]))
          };
          case null ""
        }
      }
    }
  };
  func removeStored(path : Text) {
    bumpInventory();
    switch (metadata(path)) { case (?r) { total_bytes := subBytes(total_bytes, r.length) }; case null {} };
    switch (stable_blobs.get(path)) { case (?r) { MultiBytes.release(multi_bytes, r.slice); stable_blobs.remove(path) }; case null {} };
    blobs := blobs.filter(func(r) = r.path != path);
    blob_uploaded_at := blob_uploaded_at.filter(func((p, _)) = p != path)
  };

  /// Copy one legacy file per call, without awaits or an upgrade-time loop.
  /// Publish only after exact SHA-256 read-back; preserve path/owner/timestamp.
  public shared ({ caller }) func migrate_legacy_blob() : async { #Ok : { remaining : Nat; copied_bytes : Nat }; #Err : Text } {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (media_transfer_fences.size() != 0) return #Err("Club media transfer in progress");
    if (retained_mode == #frozen) return #Err("Retained snapshot frozen");
    bumpInventory();
    if (pending_uploads.size() != 0) return #Err("Drain uploads before migration");
    if (blobs.size() == 0) return #Ok({ remaining = 0; copied_bytes = 0 });
    let old = blobs[0];
    if (stable_blobs.size() >= UploadPolicy.maxStoredFiles) return #Err("Stable metadata capacity reached");
    if (old.bytes.size() > UploadPolicy.maxWireBytes.toNat()) return #Err("Legacy file exceeds bounded migration limit");
    if (PrimMem.rts_heap_size() + old.bytes.size() * 16 > UploadPolicy.heapBudget) return #Err("Insufficient heap headroom for verified migration");
    let ?slice = MultiBytes.writeWithin(multi_bytes, old.bytes, StableBytes.limit, multiRegionWrites()) else return #Err("Stable region capacity reached");
    let copied = MultiBytes.read(multi_bytes, slice, 0, slice.length);
    if (copied.size() != old.bytes.size() or hexDigest(copied) != old.content_hash) {
      MultiBytes.release(multi_bytes, slice); return #Err("Ciphertext integrity check failed")
    };
    let stamp = switch (blob_uploaded_at.find(func((p, _)) = p == old.path)) { case (?(_, t)) t; case null Time.now() };
    stable_blobs.add(old.path, { path = old.path; owner = old.owner; mime = old.mime; content_hash = old.content_hash; slice; uploaded_at = stamp });
    blobs := blobs.filter(func(r) = r.path != old.path);
    blob_uploaded_at := blob_uploaded_at.filter(func((p, _)) = p != old.path);
    #Ok({ remaining = blobs.size(); copied_bytes = copied.size() })
  };
  public shared ({ caller }) func enable_stable_media_storage() : async Result {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (retained_mode == #frozen) return #Err("Retained snapshot frozen");
    if (blobs.size() != 0 or pending_uploads.size() != 0) return #Err("Migrate legacy files and drain uploads first");
    stable_writes := true;
    #Ok
  };
  public query func stable_storage_status() : async { enabled : Bool; legacy_count : Nat; indexed_count : Nat; allocated_bytes : Nat64 } {
    { enabled = stable_writes; legacy_count = blobs.size(); indexed_count = stable_blobs.size(); allocated_bytes = MultiBytes.allocated(multi_bytes) }
  };
  // Exact per-store allocator observations, not an aggregate group promise.
  // Authenticated operator/authority only, locally gated; no club paths/PII.
  public shared ({ caller }) func read_physical_growth_capacity() : async {
    #Ok : { revision : Nat; configured_bytes : Nat; allocated_bytes : Nat; pending_slot_bytes : Nat;
      pending_count : Nat; legacy_pending_count : Nat; allocatable_object_slots : Nat; max_object_slot_bytes : Nat };
    #Err : Text
  } {
    if (not physicalReservationRehearsal or (not isGovernor<system>(caller) and ?caller != club_domain_canister)) return #Err("Local capacity authority required");
    if (not stable_writes or blobs.size() != 0) return #Err("Complete stable-only store required");
    var held = 0;
    var legacyPending = 0;
    for (upload in pending_uploads.values()) {
      switch (upload_slots.get(upload.id)) { case (?slice) held += slice.slot; case null legacyPending += 1 }
    };
    if (upload_slots.size() + legacyPending != pending_uploads.size()) return #Err("Physical reservation inventory mismatch");
    #Ok({ revision = media_inventory_revision; configured_bytes = capacity_limit_bytes.toNat();
      allocated_bytes = MultiBytes.allocated(multi_bytes).toNat(); pending_slot_bytes = held; pending_count = pending_uploads.size();
      legacy_pending_count = legacyPending; allocatable_object_slots = if (legacyPending > 0) 0 else MultiBytes.allocatableRoots(multi_bytes, capacity_limit_bytes.toNat(), multiRegionWrites()); max_object_slot_bytes = 16_777_216 })
  };

  func findUpload(id : Text) : ?PendingUpload {
    Array.find<PendingUpload>(pending_uploads, func(upload) { upload.id == id })
  };

  func hexDigest(bytes : Blob) : Text {
    let digest = Sha256.fromBlob(#sha256, bytes);
    let hexDigits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
    var out = "";
    for (byte in digest.values()) {
      out #= hexDigits[Nat8.toNat(byte) / 16] # hexDigits[Nat8.toNat(byte) % 16];
    };
    out
  };

  // ==================== Upload protocol ====================

  // Read-only recovery evidence for isolated owner-path tests. No club paths,
  // shared ledgers or arbitrary prefixes; clearing still uses abort_upload.
  public shared ({ caller }) func read_pending_test_uploads(prefix : Text) : async { #Ok : [{ id : Text; path : Text; size : Nat64 }]; #Err : Text } {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    let parts = Text.split(prefix, #char '/').toArray();
    if (parts.size() != 4 or parts[0] != "users" or parts[1] != "network-test" or parts[2] == "" or parts[2].size() > 48 or parts[3] != "") return #Err("Isolated test prefix required");
    if (club_domain_canister != null or quota_mode != #local or retained_mode != #local) return #Err("Unregistered local-quota test store required");
    if (pending_uploads.size() > UploadPolicy.maxPending) return #Err("Pending inventory exceeds bound");
    var rows : [{ id : Text; path : Text; size : Nat64 }] = [];
    for (upload in pending_uploads.values()) {
      if (not upload.path.startsWith(#text prefix) or not upload.owner.equal(caller)) return #Err("Foreign pending upload; operator reconciliation required");
      rows := rows.concat([{ id = upload.id; path = upload.path; size = upload.total_size }]);
    };
    #Ok(rows)
  };

  // Governor-only operator read: every pending upload, so an operator can
  // drain them with abort_upload before storage migration. No bytes.
  public shared ({ caller }) func read_pending_uploads() : async { #Ok : [{ id : Text; path : Text; size : Nat64 }]; #Err : Text } {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (pending_uploads.size() > UploadPolicy.maxPending) return #Err("Pending inventory exceeds bound");
    #Ok(Array.map<PendingUpload, { id : Text; path : Text; size : Nat64 }>(pending_uploads, func(u) = { id = u.id; path = u.path; size = u.total_size }))
  };

  public shared ({ caller }) func begin_upload(path : Text, mime : Text, total_size : Nat64, chunk_count : Nat32) : async ResultUploadId {
    if (not removalReceiver.enter(caller)) Runtime.trap("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (mediaFenced(path)) return #Err("Club media frozen for transfer");
    if (retainedBlocked()) return #Err("Retained store frozen or unavailable");
    if (quota_mode == #frozen) return #Err("Uploads temporarily frozen for quota cutover");
    if ((retained_mode != #local and not RetainedProtocol.validPath(path)) or path == "" or path.size() > 1_024 or mime.size() > 256) return #Err("Invalid path or MIME");
    if (total_size > UploadPolicy.maxWireBytes) return #Err("FileTooLarge");
    if (not UploadPolicy.validDeclaration(total_size, chunk_count.toNat())) return #Err("Invalid chunk declaration");
    if (quota_mode == #sharedQuota) {
      switch (pending_uploads.find(func(u) = u.path == path)) {
        case (?upload) {
          if (not upload.owner.equal(caller) or upload.mime != mime or upload.total_size != total_size or upload.chunk_count != chunk_count) return #Err("Upload already in progress for path");
          if (quota_operations.get(upload.id) == null) return #Ok(upload.id);
          return await reserveShared(upload)
        };
        case null {}
      }
    };
    // Sharding: refuse new bytes past the threshold so the app moves on to
    // the next photo store. Existing blobs stay readable forever.
    if (not canReserve(total_size)) return #Err("StoreFull");
    if (quota_mode == #local and not isGovernor<system>(caller)) {
      let allowanceClub = if (categoryForPath(path) != null) clubIdFromPath(path) else null;
      let allowance = switch (allowanceClub) { case (?_) await pathAllowance(path); case null null };
      if (allowanceClub != null and allowance == null) return #Err("StorageAllowanceUnavailable");
      let isPro = switch (allowance) { case (?a) a.premium; case null false };
      if (accountAdmissionEnabled) await admitAccount(caller);
      try { await requireUploadMembership(caller, path) } catch (e) { return #Err(Error.message(e)) };
      // Check committed usage and outstanding reservations AFTER the await,
      // immediately before reserving. Concurrent sends cannot bypass caps.
      switch (checkFreeCap(path, total_size, isPro)) {
        case (?msg) { return #Err(msg) };
        case null {};
      };
      // No await between this check and the reservation below.
      switch (allowanceClub, allowance) {
        case (?c, ?a) {
          let (used, pending) = scopedMediaBytes(c, if (a.team_scoped) mediaTeam(path) else null);
          let limit = a.limit_bytes;
          if (not UploadPolicy.withinMediaAllowance(used, pending, MediaByteAccounting.pendingBytes(total_size.toNat()), limit)) return #Err("StorageAllowanceFull");
        };
        case _ {};
      };
    };
    if (retainedBlocked()) return #Err("Retained store frozen or unavailable");
    if (quota_mode == #frozen) return #Err("Uploads temporarily frozen for quota cutover");
    switch (metadata(path)) {
      case (?existing) {
        if (not existing.owner.equal(caller) and not isGovernor<system>(caller)) {
          return #Err("Path already has a finalized blob owned by someone else");
        };
      };
      case null {};
    };
    // Recheck after the subscription await: another upload may have reserved
    // capacity while this request was suspended. Reservation is now atomic.
    if (not canReserve(total_size)) return #Err("StoreFull");
    if (pending_uploads.size() >= UploadPolicy.maxPending) return #Err("StoreFull");
    if (pending_uploads.filter(func(item) { item.owner.equal(caller) }).size() >= UploadPolicy.maxPendingPerOwner) return #Err("Too many pending uploads");
    if (pending_uploads.any(func(item) { item.path == path })) return #Err("Upload already in progress for path");
    if (pathMutationPending(path)) return #Err("Path mutation pending");
    if (mediaFenced(path)) return #Err("Club media frozen for transfer");
    bumpInventory();
    next_upload_seq += 1;
    let id = if (retained_mode == #active) "r1:" # currentCycle().toText() # ":" # next_upload_seq.toText() # ":upload" else "upload-" # Nat64.toText(next_upload_seq);
    // Reserve the actual class before the authority await or any chunks.
    // Unknown authority replies keep the same extent until settled abort.
    if (physicalReservationRehearsal and stable_writes) {
      let ?slice = MultiBytes.reserveWithin(multi_bytes, total_size.toNat(), capacity_limit_bytes.toNat(), multiRegionWrites()) else return #Err("StoreFull");
      upload_slots.add(id, slice)
    };
    let upload : PendingUpload = {
      id;
      path;
      mime;
      owner = caller;
      total_size;
      chunk_count;
      chunks = Array.repeat<?Blob>(null, Nat32.toNat(chunk_count));
    };
    pending_uploads := pending_uploads.concat([upload]);
    if (quota_mode == #sharedQuota) {
      let uploadCategory = if (retained_mode == #active and clubIdFromPath(path) != null) ?(categoryForPath(path) ?? "branding") else categoryForPath(path);
      switch (uploadCategory, clubIdFromPath(path)) {
        case (?category, ?club_id) {
          if (quota_operations.size() >= 100_000) { releaseUploadSlot(id); pending_uploads := pending_uploads.filter(func(u) = u.id != id); return #Err("Upload outcome ledger full; retire terminal outcomes") };
          let op : QuotaOperation.Operation = { owner = caller; path; club_id; category; bytes = total_size.toNat(); cycle = currentCycle(); created_at = Time.now(); status = #reserving; result = null };
          quota_operations.add(id, op);
          return await reserveShared(upload)
        };
        case _ {}
      }
    };
    #Ok(id)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func put_chunk(upload_id : Text, index : Nat32, data : Blob) : async Result {
    if (not removalReceiver.enter(caller)) Runtime.trap("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (retainedBlocked()) return #Err("Retained store frozen or unavailable");
    let ?pending = findUpload(upload_id) else return #Err("Unknown upload");
    if (not pending.owner.equal(caller)) return #Err("Not the upload owner");
    try { await requireUploadMembership(caller, pending.path) } catch (e) { return #Err(Error.message(e)) };
    switch (findUpload(upload_id)) {
      case null { #Err("Unknown upload") };
      case (?upload) {
        if (not upload.owner.equal(caller)) return #Err("Not the upload owner");
        switch (quota_operations.get(upload_id)) { case (?op) { if (not QuotaOperation.canWrite(op)) return #Err("Upload is not writable") }; case null {} };
        if (index >= upload.chunk_count) return #Err("Chunk index out of range");
        let position = Nat32.toNat(index);
        let replaced = switch (upload.chunks[position]) { case (?bytes) bytes.size(); case null 0 };
        if (not UploadPolicy.canWriteChunk(upload.total_size, storedChunkBytes(upload), replaced, data.size(), PrimMem.rts_heap_size())) return #Err("Chunk exceeds size or memory budget");
        let chunks = Array.tabulate<?Blob>(upload.chunks.size(), func(i) {
          if (i == position) ?data else upload.chunks[i]
        });
        pending_uploads := pending_uploads.map(func(item) {
          if (item.id == upload_id) { { upload with chunks } } else item
        });
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func finalize_upload(upload_id : Text) : async ResultFinalized {
    if (not removalReceiver.enter(caller)) Runtime.trap("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (retainedBlocked()) return #Err("Retained store frozen or unavailable");
    let path = switch (findUpload(upload_id), quota_operations.get(upload_id)) {
      case (?upload, _) upload.path;
      case (null, ?op) op.path;
      case _ return #Err("Unknown upload")
    };
    // Fetch the current allowance before taking the final upload snapshot.
    // The synchronous recheck below charges malformed/legacy raw bytes in
    // full instead of granting an unearned framing discount.
    let needsAllowance = quota_mode == #local and categoryForPath(path) != null and clubIdFromPath(path) != null and not isGovernor<system>(caller);
    let finalAllowance = if (needsAllowance) await pathAllowance(path) else null;
    if (needsAllowance and finalAllowance == null) return #Err("StorageAllowanceUnavailable");
    bumpInventory();
    switch (quota_operations.get(upload_id)) {
      case (?op) {
        if (not op.owner.equal(caller)) return #Err("Not the upload owner");
        if (op.status == #committed or op.status == #committing) return await commitShared(upload_id);
        if (op.status != #uploading) return #Err("Upload not ready to finalize")
      };
      case null {}
    };
    switch (findUpload(upload_id)) {
      case null { #Err("Unknown upload") };
      case (?upload) {
        if (not upload.owner.equal(caller)) return #Err("Not the upload owner");
        if (upload.chunks.any(func(chunk) { chunk == null })) {
          return #Err("Missing chunks");
        };
        if (storedChunkBytes(upload) != upload.total_size.toNat()) return #Err("Accumulated byte count does not match total_size");
        if (PrimMem.rts_heap_size() + upload.total_size.toNat() * 16 > UploadPolicy.heapBudget) return #Err("StoreFull");
        let assembled = AssembleChunks.assemble(upload.chunks, upload.total_size.toNat());
        if (Nat.toNat64(assembled.size()) != upload.total_size) {
          return #Err("Accumulated byte count does not match total_size");
        };
        switch (finalAllowance, clubIdFromPath(upload.path)) {
          case (?a, ?club) {
            let actual = MediaByteAccounting.storedBytes(assembled, assembled.size());
            if (actual > MediaByteAccounting.maxPlaintextBytes) return #Err("FileTooLarge");
            let (used, pending) = scopedMediaBytes(club, if (a.team_scoped) mediaTeam(upload.path) else null);
            let ownPending = MediaByteAccounting.pendingBytes(upload.total_size.toNat());
            if (pending < ownPending or not UploadPolicy.withinMediaAllowance(used, pending - ownPending, actual, a.limit_bytes)) return #Err("StorageAllowanceFull");
          };
          case _ {}
        };
        let content_hash = hexDigest(assembled);
        let record : BlobRecord = {
          path = upload.path;
          mime = upload.mime;
          owner = upload.owner;
          bytes = assembled;
          content_hash;
        };
        // Replace any prior blob at this path (re-upload by owner/governor).
        if (stable_writes) {
          if (stable_blobs.size() >= UploadPolicy.maxStoredFiles and stable_blobs.get(upload.path) == null) return #Err("Stable metadata capacity reached");
          let slice = switch (upload_slots.get(upload_id)) {
            case (?held) {
              if (not physicalReservationRehearsal) return #Err("Physical reservation rehearsal disabled; restore before finalizing");
              if (not MultiBytes.writeReserved(multi_bytes, held, assembled)) return #Err("Physical reservation mismatch");
              held
            };
            // Old uploads survive an additive upgrade, but have no promise.
            case null { let ?fresh = MultiBytes.writeWithin(multi_bytes, assembled, capacity_limit_bytes.toNat(), multiRegionWrites()) else return #Err("StoreFull"); fresh }
          };
          removeStored(upload.path);
          stable_blobs.add(upload.path, { path = upload.path; mime = upload.mime; owner = upload.owner; content_hash; slice; uploaded_at = Time.now() });
          // Ownership transfers atomically from pending upload to live object.
          upload_slots.remove(upload_id);
        } else {
          removeStored(upload.path);
          blobs := blobs.concat([record]);
        };
        total_bytes += Nat.toNat64(assembled.size());
        if (retained_mode == #active and RetainedProtocol.club(upload.path) != null) retained_revisions.add(upload.path, (retained_revisions.get(upload.path) ?? 0) + 1);
        if (not stable_writes) blob_uploaded_at := blob_uploaded_at.concat([(upload.path, Time.now())]);
        switch (categoryForPath(upload.path), clubIdFromPath(upload.path)) {
          case (?category, ?clubId) { recordUsage(clubId, category, upload.total_size) };
          case _ {};
        };
        pending_uploads := pending_uploads.filter(func(item) { item.id != upload_id });
        switch (quota_operations.get(upload_id)) {
          case (?op) {
            // Blob + result + intent commit atomically BEFORE the await.
            // Aborting can no longer release this upload's allowance.
            quota_operations.add(upload_id, { op with status = #committing; result = ?{ path = upload.path; content_hash; content_length = upload.total_size } });
            return await commitShared(upload_id)
          };
          case null {
            // Local-mode removal enforcement after the atomic write; shared
            // mode enforces membership inside commitShared so an authority
            // outage stays retryable through the journal.
            try { await requireUploadMembershipForCommit(caller, upload.path) } catch (e) { return #Err(Error.message(e)) };
          }
        };
        #Ok({
          path = upload.path;
          content_hash;
          content_length = upload.total_size;
        })
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func abort_upload(upload_id : Text) : async Result {
    if (not removalReceiver.enter(caller)) Runtime.trap("Account removal fenced or operation capacity reached");
    try {
    if (not isGovernor<system>(caller)) await admitAccount(caller);
    auth(caller);
    bumpInventory();
    switch (quota_operations.get(upload_id)) {
      case (?op) {
        if (not op.owner.equal(caller) and not isGovernor<system>(caller)) return #Err("Not the upload owner");
        return await abortShared(upload_id)
      };
      case null {}
    };
    switch (findUpload(upload_id)) {
      case null { #Err("Unknown upload") };
      case (?upload) {
        if (not upload.owner.equal(caller) and not isGovernor<system>(caller)) {
          return #Err("Not the upload owner");
        };
        releaseUploadSlot(upload_id);
        pending_uploads := pending_uploads.filter(func(item) { item.id != upload_id });
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ==================== Reads ====================

  // Ciphertext length/hash are public byte properties; principal evidence is service-private.
  public shared ({ caller }) func read_vault_blob_evidence(subject : Principal, path : Text) : async { #Ok : { owner : Principal; size : Nat; content_hash : Text }; #Err : Text } {
    if (vaultAuthority != ?caller) return #Err("Vault authority required");
    await admitAccount(subject);
    if (mediaFenced(path)) return #Err("Media frozen");
    let record = metadata(path) ?? return #Err("File bytes unavailable");
    if (not record.owner.equal(subject) and not isGovernor<system>(subject) and not (await isClubStaffForPath(subject, path))) return #Err("File access forbidden");
    if (vaultAuthority != ?caller or metadata(path) != ?record or mediaFenced(path)) return #Err("File evidence changed");
    #Ok({ owner = record.owner; size = MediaByteAccounting.storedBytes(readRange(path, 0), record.length); content_hash = record.content_hash })
  };
  public shared ({ caller }) func set_vault_authority(id : Principal) : async Result {
    if (not isGovernor<system>(caller) or id.equal(Principal.anonymous())) return #Err("Governor required");
    vaultAuthority := ?id; #Ok
  };

  public query func get_content_hash(path : Text) : async ?Text {
    switch (metadata(path)) {
      case (?record) { ?record.content_hash };
      case null { null };
    }
  };

  // Club-domain pointer is governor-only; while unset, club-staff deletes
  // never authorize (fail closed).
  public shared ({ caller }) func set_club_domain_canister(canister_id : Principal) : async Result {
    auth(caller);
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if ((quota_mode != #local or retained_mode != #local) and club_domain_canister != ?canister_id) return #Err("Quota authority immutable after freeze");
    if (media_transfer_fences.size() != 0) return #Err("Club media transfer in progress");
    bumpInventory();
    club_domain_canister := ?canister_id;
    #Ok
  };

  // Extracts the club id from a clubs/<clubId>/... path, if present.
  func clubIdFromPath(path : Text) : ?Text {
    if (not path.startsWith(#text "clubs/")) return null;
    let rest = switch (Text.stripStart(path, #text "clubs/")) {
      case (?stripped) { stripped };
      case null { return null };
    };
    switch (Text.split(rest, #char '/').next()) {
      case (?clubId) { if (clubId == "") null else ?clubId };
      case null { null };
    }
  };

  // Club staff (verified live via club_domain) may delete blobs under their
  // club's prefix so permanent vault/photo deletion does not leave orphaned
  // ciphertext behind. Best-effort: verification failure means no grant.
  func isClubStaffForPath(caller : Principal, path : Text) : async Bool {
    let ?clubId = clubIdFromPath(path) else return false;
    let ?cid = club_domain_canister else return false;
    let clubDomain : actor { has_club_staff_role : shared query (Principal, Text) -> async Bool; read_has_club_staff_role : shared (Principal, Text) -> async Bool } = actor (Principal.toText(cid));
    try {
      let allowed = if (accountAdmissionEnabled) await clubDomain.read_has_club_staff_role(caller, clubId) else await clubDomain.has_club_staff_role(caller, clubId);
      await admitAccount(caller);
      allowed and club_domain_canister == ?cid
    } catch (_) {
      false
    }
  };

  public shared ({ caller }) func delete_blob(path : Text) : async Result {
    if (not removalReceiver.enter(caller)) Runtime.trap("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (mediaFenced(path)) return #Err("Club media frozen for transfer");
    if (retainedBlocked()) return #Err("Retained store frozen or unavailable");
    switch (retained_deletions.get(path)) {
      case (?receipt) {
        if (not receipt.owner.equal(caller) and not isGovernor<system>(caller) and not (await isClubStaffForPath(caller, path))) return #Err("Owner, club staff, or governor required");
        return await creditDeletion(path)
      };
      case null {}
    };
    switch (metadata(path)) {
      case null { #Err("Unknown blob") };
      case (?record) {
        if (not record.owner.equal(caller) and not isGovernor<system>(caller)) {
          if (not (await isClubStaffForPath(caller, path))) {
            return #Err("Owner, club staff, or governor required");
          };
        };
        // Authorization may yield; never apply stale accounting to a replacement.
        switch (metadata(path)) { case (?current) { if (current.content_hash != record.content_hash or current.owner != record.owner) return #Err("Blob changed; retry delete") }; case null return #Ok };
        if (mediaFenced(path)) return #Err("Club media frozen for transfer");
        await deleteRetained(path)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Only the configured Vault may delegate a human-authorized, exact-object delete.
  // Timer-only Vault retention delegates no human. Recheck exact age, hash,
  // current scoped allowance and configured authority before irreversible deletion.
  public shared ({ caller }) func delete_expired_vault_blob(path : Text, expected_hash : Text) : async Result {
    if (vaultAuthority != ?caller or categoryForPath(path) != ?"vault") return #Err("Vault authority required");
    if (mediaFenced(path) or retainedBlocked() or quota_mode == #frozen or pathMutationPending(path)) return #Err("Media mutation pending");
    let authority = vaultAuthority; let clubAuthority = club_domain_canister;
    let record = metadata(path);
    switch record {
      case null {
        if (deletionHashes.get(path) != ?expected_hash) return #Err("Expired cleanup receipt unavailable");
        return await creditDeletion(path)
      };
      case (?r) {
        if (r.content_hash != expected_hash) return #Err("Expired file hash changed");
        let stamp = switch (stable_blobs.get(path)) { case (?s) s.uploaded_at; case null { switch (blob_uploaded_at.find(func e = e.0 == path)) { case (?e) e.1; case null return #Err("File age unavailable") } } };
        if (Time.now() - stamp <= RETENTION_NS) return #Err("File retention not expired");
        let allowance = await pathAllowance(path);
        if (vaultAuthority != authority or club_domain_canister != clubAuthority or metadata(path) != record or mediaFenced(path) or retainedBlocked() or quota_mode == #frozen or pathMutationPending(path)) return #Err("Retention scope changed");
        switch allowance { case (?a) if (a.premium) return #Err("Paid media is retained"); case null return #Err("Allowance unavailable") };
        // Pin a local-mode receipt too, so a lost reply cannot turn mere absence into proof.
        deletionHashes.add(path, expected_hash);
        await deleteRetained(path)
      }
    }
  };

  public shared ({ caller }) func delete_erased_scope_vault_blob(path : Text, expected_hash : Text) : async Result {
    if (vaultAuthority != ?caller or categoryForPath(path) != ?"vault") return #Err("Vault authority required");
    if (mediaFenced(path) or retainedBlocked() or quota_mode == #frozen or pathMutationPending(path)) return #Err("Media mutation pending");
    let cid = club_domain_canister ?? return #Err("Club authority unavailable");
    let club = clubIdFromPath(path) ?? return #Err("Club scope unavailable");
    let authority = vaultAuthority; let record = metadata(path);
    let cd : actor { read_vault_erasure_scope : shared query (Text, ?Text) -> async Bool } = actor(cid.toText());
    let erased = try { await (with timeout = 10) cd.read_vault_erasure_scope(club, mediaTeam(path)) } catch (_) { return #Err("Erasure evidence unavailable") };
    if (not erased or club_domain_canister != ?cid or vaultAuthority != authority or metadata(path) != record or mediaFenced(path) or retainedBlocked() or pathMutationPending(path)) return #Err("Erasure scope changed");
    switch record {
      case null { if (deletionHashes.get(path) != ?expected_hash) return #Err("Erasure receipt unavailable"); await creditDeletion(path) };
      case (?r) { if (r.content_hash != expected_hash) return #Err("Erased file hash changed"); deletionHashes.add(path, expected_hash); await deleteRetained(path) }
    }
  };

  // The final hash comparison and creation of the retained deletion intent have no await between them.
  public shared ({ caller }) func delete_vault_blob(subject : Principal, path : Text, expected_hash : Text) : async Result {
    if (vaultAuthority != ?caller) return #Err("Vault authority required");
    if (not removalReceiver.enter(subject)) return #Err("Account fenced");
    try {
      await admitAccount(subject); auth(subject);
      if (categoryForPath(path) != ?"vault" or expected_hash == "") return #Err("Vault path and hash required");
      if (mediaFenced(path) or retainedBlocked()) return #Err("Media frozen");
      let authority = vaultAuthority;
      let original = metadata(path);
      switch original {
        case null {
          // A remaining credit operation must settle before Vault can finalize metadata.
          switch (retained_deletions.get(path)) {
            case null return #Ok;
            case (?receipt) {
              if (deletionHashes.get(path) != ?expected_hash) return #Err("Cleanup receipt hash mismatch");
              if (not receipt.owner.equal(subject) and not isGovernor<system>(subject) and not (await isClubStaffForPath(subject, path))) return #Err("Scoped staff required");
              if (vaultAuthority != authority or mediaFenced(path) or removalReceiver.denied(subject)) return #Err("Cleanup authority changed");
              return await creditDeletion(path)
            }
          }
        };
        case (?record) {
          if (record.content_hash != expected_hash) return #Err("Vault blob hash changed");
          if (retained_deletions.get(path) != null and deletionHashes.get(path) != ?expected_hash) return #Err("Cleanup receipt hash mismatch");
          if (not record.owner.equal(subject) and not isGovernor<system>(subject) and not (await isClubStaffForPath(subject, path))) return #Err("Scoped staff required");
          if (vaultAuthority != authority or removalReceiver.denied(subject) or mediaFenced(path) or retainedBlocked() or metadata(path) != ?record) return #Err("Cleanup object or authority changed");
          if (pathMutationPending(path) and retained_deletions.get(path) == null) return #Err("Upload mutation pending");
          await deleteRetained(path)
        }
      }
    } finally { removalReceiver.leave(subject) }
  };

  // Serves ciphertext only — see the module header. No authorization here:
  // read access is enforced at vetKey derivation time on pii_access_control.
  public query func http_request(request : HttpRequest) : async HttpResponse {
    if (request.method != "GET") {
      return { status_code = 405; headers = []; body = ""; streaming_strategy = null };
    };
    let withoutQuery = switch (Text.split(request.url, #char '?').next()) {
      case (?head) { head };
      case null { request.url };
    };
    let path = if (withoutQuery.startsWith(#char '/')) {
      switch (Text.stripStart(withoutQuery, #char '/')) {
        case (?stripped) { stripped };
        case null { withoutQuery };
      };
    } else withoutQuery;
    switch (metadata(path)) {
      case null { { status_code = 404; headers = []; body = ""; streaming_strategy = null } };
      case (?record) {
        {
          status_code = 200;
          headers = [
            ("content-type", record.mime),
            ("cache-control", "public, max-age=31536000, immutable"),
          ];
          body = readRange(path, 0);
          streaming_strategy = if (record.length <= StableBytes.responseChunk) null else ?#Callback({
            callback = MediaBlobStore.http_request_streaming_callback;
            token = { path; content_hash = record.content_hash; offset = StableBytes.responseChunk }
          });
        };
      };
    }
  };
  public query func http_request_streaming_callback(token : StreamToken) : async StreamResponse {
    let ?record = metadata(token.path) else return { body = ""; token = null };
    if (record.content_hash != token.content_hash or token.offset >= record.length) return { body = ""; token = null };
    let body = readRange(token.path, token.offset);
    let next = token.offset + body.size();
    { body; token = if (next >= record.length) null else ?{ token with offset = next } }
  };

  type Usage = {
    total_bytes : Nat64;
    capacity_limit_bytes : Nat64;
    accepting_uploads : Bool;
  };

  // Sharding: the app reads this to skip full stores and to show fullness in
  // Placement Settings. Public query — reveals only byte totals.
  public query func get_usage() : async Usage {
    { total_bytes; capacity_limit_bytes = if (capacity_limit_bytes > mediaCapacityCeiling()) mediaCapacityCeiling() else capacity_limit_bytes; accepting_uploads = quota_mode != #frozen and not retainedBlocked() and canReserve(1) and pending_uploads.size() < UploadPolicy.maxPending }
  };
  func mediaCapacityCeiling() : Nat64 {
    UploadPolicy.ceilingFor(largeMode())
  };

  // Governor-only. Setting a limit at or below the current total closes the
  // store to new uploads (read-only); raising it reopens it.
  public shared ({ caller }) func set_capacity_limit(limit_bytes : Nat64) : async Result {
    auth(caller);
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (limit_bytes > mediaCapacityCeiling()) return #Err(if (largeMode()) "Store capacity cannot exceed 200 GiB" else "Heap-backed store capacity cannot exceed 2 GiB");
    capacity_limit_bytes := limit_bytes;
    #Ok
  };

  public query func health() : async Health {
    {
      version = "1";
      blob_count = Nat.toNat64(blobs.size() + stable_blobs.size());
      total_bytes;
    }
  };
  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  // Covers: BlobRecord.owner, PendingUpload.owner. club_domain_canister is canister wiring and is
  // never rewritten.
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    rekeyImpl<system>(caller, old, new, dry_run, false)
  };

  // Same as rekey_principal, but allowed when the new sign-in ID already has data:
  // both IDs' records end up under the new one (keyed duplicates keep the new row).
  public shared ({ caller }) func merge_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    rekeyImpl<system>(caller, old, new, dry_run, true)
  };

  func rekeyImpl<system>(caller : Principal, old : Principal, new : Principal, dry_run : Bool, allowMerge : Bool) : { #ok : Nat; #err : Text } {
    auth(caller);
    if (not isGovernor<system>(caller)) return #err("Forbidden");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #err("Invalid principal");
    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Removed identity cannot be rekeyed or merged");
    if (old.equal(new)) return #err("old and new principal must differ");
    if (isGovernor<system>(old)) return #err("Cannot rekey the governor");

    var conflicts = 0;
    conflicts += blobs.filter(func(b : BlobRecord) : Bool = b.owner.equal(new)).size();
    for ((_, r) in stable_blobs.entries()) { if (r.owner.equal(new)) conflicts += 1 };
    conflicts += pending_uploads.filter(func(u : PendingUpload) : Bool = u.owner.equal(new)).size();
    if (conflicts > 0 and not allowMerge) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in media_blob_store");

    var changed = 0;

    let newBlobs = blobs.map(func(b : BlobRecord) : BlobRecord {
      if (b.owner.equal(old)) { changed += 1; { b with owner = new } } else b
    });

    let newPendingUploads = pending_uploads.map(func(u : PendingUpload) : PendingUpload {
      if (u.owner.equal(old)) { changed += 1; { u with owner = new } } else u
    });
    var stableRekeys : [(Text, StoredRecord)] = [];
    for ((p, r) in stable_blobs.entries()) {
      if (r.owner.equal(old)) { changed += 1; stableRekeys := stableRekeys.concat([(p, { r with owner = new })]) }
    };

    if (not dry_run) {
      if (media_transfer_fences.size() != 0) return #err("Club media transfer in progress");
      if (retained_mode == #frozen or retained_deletions.size() != 0) return #err("Retained snapshot or deletion pending");
      bumpInventory();
      blobs := newBlobs;
      pending_uploads := newPendingUploads;
      for ((p, r) in stableRekeys.values()) stable_blobs.add(p, r);
      var rekeys : [(Text, QuotaOperation.Operation)] = [];
      for ((id, op) in quota_operations.entries()) { if (op.owner.equal(old)) rekeys := rekeys.concat([(id, { op with owner = new })]) };
      for ((id, op) in rekeys.values()) quota_operations.add(id, op);
    };

    #ok(changed)
  };



  // ==================== Retention (free clubs: 6 months) ====================

  /// ?true pro, ?false free, null = unknown (skip — never delete on doubt).
  func clubProStatus(clubId : Text) : async ?Bool {
    let ?cid = club_domain_canister else return null;
    let clubDomain : actor {
      get_club_subscription : shared query Text -> async { #Ok : ?{ is_pro : Bool; admin_pro_override : Bool; is_pro_football : Bool; admin_pro_football_override : Bool; is_trial : Bool }; #Err : Text };
    } = actor (Principal.toText(cid));
    try {
      switch (await clubDomain.get_club_subscription(clubId)) {
        case (#Ok(?sub)) { ?(sub.is_pro or sub.admin_pro_override or sub.is_pro_football or sub.admin_pro_football_override or sub.is_trial) };
        case (#Ok(null)) { ?false };
        case (#Err(_)) { null };
      }
    } catch (_) { null }
  };

  func sweepRetention() : async () {
    if (retainedBlocked() or quota_mode == #frozen) return;
    // Indexed stable records: materialize one bounded page before any await.
    var page : [(Text, StoredRecord)] = [];
    for ((p, r) in stable_blobs.entriesFrom(retention_cursor)) {
      if (p == retention_cursor and retention_cursor != "") continue;
      if (page.size() >= 50) break;
      page := page.concat([(p, r)])
    };
    retention_cursor := if (page.size() == 50) page[49].0 else "";
    for ((p, r) in page.values()) {
      if (categoryForPath(p) == ?"vault" and vaultAuthority != null) continue;
      if (not mediaFenced(p) and Time.now() - r.uploaded_at > RETENTION_NS) {
        switch (categoryForPath(p), clubIdFromPath(p)) {
          case (?_, ?club) {
            if ((switch (await pathAllowance(p)) { case (?a) not a.premium; case null false })) {
              if (mediaFenced(p) or retainedBlocked() or quota_mode == #frozen) continue;
              switch (stable_blobs.get(p)) {
                case (?current) { if (current.content_hash == r.content_hash and current.uploaded_at == r.uploaded_at and Time.now() - current.uploaded_at > RETENTION_NS) { ignore await deleteRetained(p) } };
                case null {}
              }
            }
          };
          case _ {}
        }
      }
    };
    // Bound legacy work by files, not clubs: one large club must not issue
    // unbounded lookups/deletes. Materialize paths before the first await.
    let indices = RetentionPage.indices(blobs.size(), legacy_retention_cursor, 50);
    legacy_retention_cursor := if (blobs.size() == 0) 0 else (legacy_retention_cursor + indices.size()) % blobs.size();
    let paths = indices.map(func(index) { blobs[index].path });
    for (p in paths.values()) {
      if (categoryForPath(p) == ?"vault" and vaultAuthority != null) continue;
      if (retainedBlocked() or quota_mode == #frozen) break;
      if (mediaFenced(p) or categoryForPath(p) == null or clubIdFromPath(p) == null) continue;
      let stamp = switch (blob_uploaded_at.find(func((path, _)) = path == p)) {
        case (?(_, t)) t;
        case null {
          // Unknown ages are never considered expired.
          blob_uploaded_at := blob_uploaded_at.concat([(p, Time.now())]);
          continue
        }
      };
      if (Time.now() - stamp <= RETENTION_NS) continue;
      let premium = switch (await pathAllowance(p)) { case (?a) ?a.premium; case null null };
      if (mediaFenced(p) or retainedBlocked() or quota_mode == #frozen) continue;
      switch (blob_uploaded_at.find(func((path, _)) = path == p)) {
        case (?(_, current)) {
          if (MediaRetentionPolicy.mayDelete(premium, stamp, current, Time.now(), RETENTION_NS)) ignore await deleteRetained(p)
        };
        case null {}
      }
    };
  };
  transient let _retentionTimer = Timer.recurringTimer<system>(#seconds(86_400), sweepRetention);



  // Additive protected consensus reads; live UI rollout is a separate release gate.
  public shared ({ caller }) func read_account_get_upload_outcome(upload_id : Text) : async { #Ok : ?FinalizedBlob; #Err : Text } {
    if (not removalReceiver.enter(caller)) Runtime.trap("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    switch (quota_operations.get(upload_id)) {
      case (?op) {
        if (not op.owner.equal(caller)) return #Err("Not the upload owner");
        if (op.status == #committed) #Ok(op.result) else #Err("Upload not committed; retry finalize or abort")
      };
      case null #Err("Unknown upload")
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func prepare_account_removal(request : RemovalReceiver.Request) : async { #Ok; #Err : Text } {
    switch (removalReceiver.prepare(caller, request)) {
      case (#Err(message)) #Err(message);
      case (#Ok) {
        // Purely local unfinished uploads can be discarded atomically. Shared
        // quota outcomes retain their journals until cancellation/commit settles.
        pending_uploads := pending_uploads.filter(func(u) {
          let keep = not removalReceiver.denied(u.owner) or quota_operations.get(u.id) != null;
          if (not keep) releaseUploadSlot(u.id);
          keep
        });
        bumpInventory(); #Ok
      }
    }
  };
  public shared ({ caller }) func read_account_removal_drain(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    var unresolved = 0;
    for (upload in pending_uploads.values()) { if (request.subjects.any(func(p) = p == upload.owner)) unresolved += 1 };
    for ((_, op) in quota_operations.entries()) {
      if (request.subjects.any(func(p) = p == op.owner) and op.status != #committed and op.status != #aborted) unresolved += 1
    };
    for ((_, receipt) in retained_deletions.entries()) { if (request.subjects.any(func(p) = p == receipt.owner)) unresolved += 1 };
    removalReceiver.receipt(caller, request, Principal.fromActor(MediaBlobStore), unresolved)
  };

  public shared ({ caller }) func seal_account_removal(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    var unresolved = 0;
    for (upload in pending_uploads.values()) { if (request.subjects.any(func(p) = p == upload.owner)) unresolved += 1 };
    for ((_, op) in quota_operations.entries()) {
      if (request.subjects.any(func(p) = p == op.owner) and op.status != #committed and op.status != #aborted) unresolved += 1
    };
    for ((_, receipt) in retained_deletions.entries()) { if (request.subjects.any(func(p) = p == receipt.owner)) unresolved += 1 };
    removalReceiver.seal(caller, request, Principal.fromActor(MediaBlobStore), unresolved)
  };
};
