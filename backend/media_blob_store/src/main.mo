import AccountAdmission "../../shared/AccountAdmission";
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
import RetentionPage "retentionPage";
import MediaInventory "mediaInventory";

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
  transient let accountAdmission = AccountAdmission.Gate(accountAdmissionEnabled, accountAdmissionAuthority);
  func admitAccount(subject : Principal) : async () {
    if (not (await accountAdmission.eligible(subject))) Runtime.trap("Account admission denied or unavailable");
  };
  func denyLegacyAccountQuery() {
    if (accountAdmissionEnabled) Runtime.trap("Use protected consensus account read");
  };
  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };
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
  var stable_blobs : Map.Map<Text, StoredRecord>;
  var stable_writes : Bool;
  var retention_cursor : Text;
  var legacy_retention_cursor : Nat;
  var media_inventory_revision : Nat;
  var media_transfer_fences : Map.Map<Text, Nat>;

  func bumpInventory() { media_inventory_revision += 1 };
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
    bumpInventory();
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (quota_mode == #sharedQuota) return #Ok;
    if (quota_mode != #frozen) return #Err("Freeze and import this store first");
    let ?service = quotaService() else return #Err("Quota authority unset");
    try {
      if (not (await service.media_quota_ready())) return #Err("All-store quota import not activated");
      quota_mode := #sharedQuota;
      bumpInventory();
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
    for (id in deletes.values()) quota_operations.remove(id);
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
      let result = await service.reserve_media_quota(upload.id, op.club_id, op.category, op.bytes, op.cycle);
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
    try {
      switch (await service.commit_media_quota(id)) {
        case (#Ok(r)) {
          bumpInventory();
          if (r.status != #committed) return #Err("Quota not committed");
          let ?latest = quota_operations.get(id) else return #Err("Missing quota journal");
          let ?result = latest.result else return #Err("Missing result");
          quota_operations.add(id, { latest with status = #committed });
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
    let ?service = quotaService() else return #Err("Quota authority unset; retry abort");
    try {
      switch (await service.cancel_media_quota(id, op.club_id, op.category, op.bytes, op.cycle)) {
        case (#Ok(r)) {
          bumpInventory();
          if (r.status != #released) return #Err("Reservation not released");
          let ?latest = quota_operations.get(id) else return #Err("Missing quota journal");
          quota_operations.add(id, { latest with status = #aborted });
          pending_uploads := pending_uploads.filter(func(u) = u.id != id);
          #Ok
        };
        case (#Err(message)) #Err(message)
      }
    } catch (_) { #Err("Quota release outcome unknown; retry abort") }
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

  func clubIsPro(clubId : Text) : async Bool {
    let ?cid = club_domain_canister else return false;
    let clubDomain : actor {
      get_club_subscription : shared query Text -> async { #Ok : ?{ is_pro : Bool; admin_pro_override : Bool; is_pro_football : Bool; admin_pro_football_override : Bool; is_trial : Bool }; #Err : Text };
    } = actor (Principal.toText(cid));
    try {
      switch (await clubDomain.get_club_subscription(clubId)) {
        case (#Ok(?sub)) { sub.is_pro or sub.admin_pro_override or sub.is_pro_football or sub.admin_pro_football_override or sub.is_trial };
        case _ { false };
      }
    } catch (_) { false }
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

  func reservedBytes() : Nat {
    var total = 0;
    for (upload in pending_uploads.values()) { total += upload.total_size.toNat() };
    total
  };

  func canReserve(size : Nat64) : Bool {
    UploadPolicy.canAdmit(capacity_limit_bytes, total_bytes, reservedBytes(), size, PrimMem.rts_heap_size()) and
    (not stable_writes or (stable_blobs.size() < 100_000 and StableBytes.canAllocate(stable_bytes, size.toNat())))
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
      case (?r) StableBytes.read(stable_bytes, r.slice, offset, StableBytes.responseChunk);
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
    switch (stable_blobs.get(path)) { case (?r) { StableBytes.release(stable_bytes, r.slice); stable_blobs.remove(path) }; case null {} };
    blobs := blobs.filter(func(r) = r.path != path);
    blob_uploaded_at := blob_uploaded_at.filter(func((p, _)) = p != path)
  };

  /// Copy one legacy file per call, without awaits or an upgrade-time loop.
  /// Publish only after exact SHA-256 read-back; preserve path/owner/timestamp.
  public shared ({ caller }) func migrate_legacy_blob() : async { #Ok : { remaining : Nat; copied_bytes : Nat }; #Err : Text } {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (media_transfer_fences.size() != 0) return #Err("Club media transfer in progress");
    bumpInventory();
    if (pending_uploads.size() != 0) return #Err("Drain uploads before migration");
    if (blobs.size() == 0) return #Ok({ remaining = 0; copied_bytes = 0 });
    let old = blobs[0];
    if (stable_blobs.size() >= 100_000) return #Err("Stable metadata capacity reached");
    if (old.bytes.size() > UploadPolicy.maxWireBytes.toNat()) return #Err("Legacy file exceeds bounded migration limit");
    if (PrimMem.rts_heap_size() + old.bytes.size() * 16 > UploadPolicy.heapBudget) return #Err("Insufficient heap headroom for verified migration");
    let ?slice = StableBytes.write(stable_bytes, old.bytes) else return #Err("Stable region capacity reached");
    let copied = StableBytes.read(stable_bytes, slice, 0, slice.length);
    if (copied.size() != old.bytes.size() or hexDigest(copied) != old.content_hash) {
      StableBytes.release(stable_bytes, slice); return #Err("Ciphertext integrity check failed")
    };
    let stamp = switch (blob_uploaded_at.find(func((p, _)) = p == old.path)) { case (?(_, t)) t; case null Time.now() };
    stable_blobs.add(old.path, { path = old.path; owner = old.owner; mime = old.mime; content_hash = old.content_hash; slice; uploaded_at = stamp });
    blobs := blobs.filter(func(r) = r.path != old.path);
    blob_uploaded_at := blob_uploaded_at.filter(func((p, _)) = p != old.path);
    #Ok({ remaining = blobs.size(); copied_bytes = copied.size() })
  };
  public shared ({ caller }) func enable_stable_media_storage() : async Result {
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (blobs.size() != 0 or pending_uploads.size() != 0) return #Err("Migrate legacy files and drain uploads first");
    stable_writes := true;
    #Ok
  };
  public query func stable_storage_status() : async { enabled : Bool; legacy_count : Nat; indexed_count : Nat; allocated_bytes : Nat64 } {
    { enabled = stable_writes; legacy_count = blobs.size(); indexed_count = stable_blobs.size(); allocated_bytes = stable_bytes.end }
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

  public shared ({ caller }) func begin_upload(path : Text, mime : Text, total_size : Nat64, chunk_count : Nat32) : async ResultUploadId {
    await admitAccount(caller);
    auth(caller);
    if (mediaFenced(path)) return #Err("Club media frozen for transfer");
    if (quota_mode == #frozen) return #Err("Uploads temporarily frozen for quota cutover");
    if (path == "" or path.size() > 1_024 or mime.size() > 256) return #Err("Invalid path or MIME");
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
      let isPro = switch (clubIdFromPath(path), categoryForPath(path)) {
        case (?clubId, ?_) { await clubIsPro(clubId) };
        case _ { false };
      };
      // Check committed usage and outstanding reservations AFTER the await,
      // immediately before reserving. Concurrent sends cannot bypass caps.
      switch (checkFreeCap(path, total_size, isPro)) {
        case (?msg) { return #Err(msg) };
        case null {};
      };
    };
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
    if (mediaFenced(path)) return #Err("Club media frozen for transfer");
    bumpInventory();
    next_upload_seq += 1;
    let id = "upload-" # Nat64.toText(next_upload_seq);
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
      switch (categoryForPath(path), clubIdFromPath(path)) {
        case (?category, ?club_id) {
          if (quota_operations.size() >= 100_000) { pending_uploads := pending_uploads.filter(func(u) = u.id != id); return #Err("Upload outcome ledger full; retire terminal outcomes") };
          let op : QuotaOperation.Operation = { owner = caller; path; club_id; category; bytes = total_size.toNat(); cycle = currentCycle(); created_at = Time.now(); status = #reserving; result = null };
          quota_operations.add(id, op);
          return await reserveShared(upload)
        };
        case _ {}
      }
    };
    #Ok(id)
  };

  public shared ({ caller }) func put_chunk(upload_id : Text, index : Nat32, data : Blob) : async Result {
    await admitAccount(caller);
    auth(caller);
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
  };

  public shared ({ caller }) func finalize_upload(upload_id : Text) : async ResultFinalized {
    await admitAccount(caller);
    auth(caller);
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
          if (stable_blobs.size() >= 100_000 and stable_blobs.get(upload.path) == null) return #Err("Stable metadata capacity reached");
          let ?slice = StableBytes.write(stable_bytes, assembled) else return #Err("StoreFull");
          removeStored(upload.path);
          stable_blobs.add(upload.path, { path = upload.path; mime = upload.mime; owner = upload.owner; content_hash; slice; uploaded_at = Time.now() });
        } else {
          removeStored(upload.path);
          blobs := blobs.concat([record]);
        };
        total_bytes += Nat.toNat64(assembled.size());
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
          case null {}
        };
        #Ok({
          path = upload.path;
          content_hash;
          content_length = upload.total_size;
        })
      };
    }
  };

  public shared ({ caller }) func abort_upload(upload_id : Text) : async Result {
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
        pending_uploads := pending_uploads.filter(func(item) { item.id != upload_id });
        #Ok
      };
    }
  };

  // ==================== Reads ====================

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
    if (quota_mode != #local and club_domain_canister != ?canister_id) return #Err("Quota authority immutable after freeze");
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
    await admitAccount(caller);
    auth(caller);
    if (mediaFenced(path)) return #Err("Club media frozen for transfer");
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
        removeStored(path);
        #Ok
      };
    }
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
    { total_bytes; capacity_limit_bytes = UploadPolicy.effectiveCapacity(capacity_limit_bytes); accepting_uploads = quota_mode != #frozen and canReserve(1) and pending_uploads.size() < UploadPolicy.maxPending }
  };

  // Governor-only. Setting a limit at or below the current total closes the
  // store to new uploads (read-only); raising it reopens it.
  public shared ({ caller }) func set_capacity_limit(limit_bytes : Nat64) : async Result {
    auth(caller);
    if (not isGovernor<system>(caller)) return #Err("Governor required");
    if (limit_bytes > UploadPolicy.capacityCeiling) return #Err("Heap-backed store capacity cannot exceed 2 GiB");
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
    // Indexed stable records: materialize one bounded page before any await.
    var page : [(Text, StoredRecord)] = [];
    for ((p, r) in stable_blobs.entriesFrom(retention_cursor)) {
      if (p == retention_cursor and retention_cursor != "") continue;
      if (page.size() >= 50) break;
      page := page.concat([(p, r)])
    };
    retention_cursor := if (page.size() == 50) page[49].0 else "";
    for ((p, r) in page.values()) {
      if (not mediaFenced(p) and Time.now() - r.uploaded_at > RETENTION_NS) {
        switch (categoryForPath(p), clubIdFromPath(p)) {
          case (?_, ?club) {
            if ((await clubProStatus(club)) == ?false) {
              if (mediaFenced(p)) continue;
              switch (stable_blobs.get(p)) {
                case (?current) { if (current.content_hash == r.content_hash and current.uploaded_at == r.uploaded_at and Time.now() - current.uploaded_at > RETENTION_NS) removeStored(p) };
                case null {}
              }
            }
          };
          case _ {}
        }
      }
    };
    let now = Time.now();
    let stamps = Map.empty<Text, Int>();
    for ((p, t) in blob_uploaded_at.values()) { Map.add(stamps, Text.compare, p, t) };
    let expiredByClub = Map.empty<Text, [Text]>();
    var fresh : [(Text, Int)] = [];
    for (b in blobs.values()) {
      switch (Map.get(stamps, Text.compare, b.path)) {
        case null { fresh := fresh.concat([(b.path, now)]) };
        case (?t) {
          if (now - t > RETENTION_NS) {
            switch (categoryForPath(b.path), clubIdFromPath(b.path)) {
              case (?_, ?clubId) {
                let prev = switch (Map.get(expiredByClub, Text.compare, clubId)) { case (?xs) xs; case null [] };
                Map.add(expiredByClub, Text.compare, clubId, prev.concat([b.path]));
              };
              case _ {};
            };
          };
        };
      };
    };
    if (fresh.size() > 0) { blob_uploaded_at := blob_uploaded_at.concat(fresh) };
    // Cap club lookups per sweep; the rest are handled on following days.
    // Materialize bounded club IDs before awaits; rotate past Pro/unavailable
    // clubs so the same first 50 never starve later free clubs.
    let clubs = Iter.toArray(expiredByClub.entries());
    let indices = RetentionPage.indices(clubs.size(), legacy_retention_cursor, 50);
    legacy_retention_cursor := if (clubs.size() == 0) 0 else (legacy_retention_cursor + indices.size()) % clubs.size();
    for (index in indices.values()) {
        let (clubId, paths) = clubs[index];
        if ((await clubProStatus(clubId)) == ?false) {
          if (media_transfer_fences.get(clubId) != null) continue;
          let doomed = Map.empty<Text, ()>();
          for (p in paths.values()) {
            // A replacement during subscription lookup must not be deleted.
            switch (blob_uploaded_at.find(func((path, _)) = path == p)) {
              case (?(_, stamp)) { if (Time.now() - stamp > RETENTION_NS) Map.add(doomed, Text.compare, p, ()) };
              case null {}
            }
          };
          var freed : Nat = 0;
          if (doomed.size() > 0) bumpInventory();
          for (b in blobs.values()) { if (Map.containsKey(doomed, Text.compare, b.path)) freed += b.bytes.size() };
          blobs := blobs.filter(func(b) { not Map.containsKey(doomed, Text.compare, b.path) });
          blob_uploaded_at := blob_uploaded_at.filter(func((p, _) : (Text, Int)) : Bool { not Map.containsKey(doomed, Text.compare, p) });
          total_bytes := subBytes(total_bytes, freed);
        };
    };
  };
  transient let _retentionTimer = Timer.recurringTimer<system>(#seconds(86_400), sweepRetention);



  // Additive protected consensus reads; live UI rollout is a separate release gate.
  public shared ({ caller }) func read_account_get_upload_outcome(upload_id : Text) : async { #Ok : ?FinalizedBlob; #Err : Text } {
    await admitAccount(caller);
    switch (quota_operations.get(upload_id)) {
      case (?op) {
        if (not op.owner.equal(caller)) return #Err("Not the upload owner");
        if (op.status == #committed) #Ok(op.result) else #Err("Upload not committed; retry finalize or abort")
      };
      case null #Err("Unknown upload")
    }
  };
};
