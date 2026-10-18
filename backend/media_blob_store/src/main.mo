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
  };
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
  transient let MAX_FILE_BYTES : Nat64 = 10_485_760; // 10 MB
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
  func checkFreeCap(path : Text, size : Nat64) : async ?Text {
    let ?category = categoryForPath(path) else return null;
    let ?clubId = clubIdFromPath(path) else return null;
    let (countLimit, bytesLimit) = limitsFor(category);
    if (size > MAX_FILE_BYTES) {
      if (category == "gallery_photo" or category == "chat_photo") return ?"FileTooLarge";
      if (not (await clubIsPro(clubId))) return ?"FileTooLarge";
    };
    let (count, bytes) = usageFor(clubId, currentCycle(), category);
    let overCount = count + 1 > countLimit;
    let overBytes = switch (bytesLimit) { case (?l) { bytes + size > l }; case null { false } };
    if (not overCount and not overBytes) return null;
    if (await clubIsPro(clubId)) return null;
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
    UploadPolicy.canAdmit(capacity_limit_bytes, total_bytes, reservedBytes(), size, PrimMem.rts_heap_size())
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
    auth(caller);
    if (path == "" or path.size() > 1_024 or mime.size() > 256) return #Err("Invalid path or MIME");
    if (total_size > UploadPolicy.maxWireBytes) return #Err("FileTooLarge");
    if (not UploadPolicy.validDeclaration(total_size, chunk_count.toNat())) return #Err("Invalid chunk declaration");
    // Sharding: refuse new bytes past the threshold so the app moves on to
    // the next photo store. Existing blobs stay readable forever.
    if (not canReserve(total_size)) return #Err("StoreFull");
    if (not isGovernor<system>(caller)) {
      switch (await checkFreeCap(path, total_size)) {
        case (?msg) { return #Err(msg) };
        case null {};
      };
    };
    switch (findBlob(path)) {
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
    next_upload_seq += 1;
    let id = "upload-" # Nat64.toText(next_upload_seq) # "-" # Principal.toText(caller);
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
    #Ok(id)
  };

  public shared ({ caller }) func put_chunk(upload_id : Text, index : Nat32, data : Blob) : async Result {
    auth(caller);
    switch (findUpload(upload_id)) {
      case null { #Err("Unknown upload") };
      case (?upload) {
        if (not upload.owner.equal(caller)) return #Err("Not the upload owner");
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
    auth(caller);
    switch (findUpload(upload_id)) {
      case null { #Err("Unknown upload") };
      case (?upload) {
        if (not upload.owner.equal(caller)) return #Err("Not the upload owner");
        if (upload.chunks.any(func(chunk) { chunk == null })) {
          return #Err("Missing chunks");
        };
        if (storedChunkBytes(upload) != upload.total_size.toNat()) return #Err("Accumulated byte count does not match total_size");
        if (PrimMem.rts_heap_size() + upload.total_size.toNat() * 16 > UploadPolicy.heapBudget) return #Err("StoreFull");
        // Linear assembly, not repeated concatenation of every preceding byte.
        var chunkIndex = 0;
        var offset = 0;
        var current : [Nat8] = [];
        let assembledArray = Array.tabulate<Nat8>(upload.total_size.toNat(), func(_) {
          while (offset >= current.size()) {
            current := switch (upload.chunks[chunkIndex]) { case (?bytes) bytes.toArray(); case null [] };
            chunkIndex += 1;
            offset := 0;
          };
          let byte = current[offset];
          offset += 1;
          byte
        });
        let assembled = Array.toBlob(assembledArray);
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
        switch (findBlob(upload.path)) {
          case (?prior) { total_bytes := subBytes(total_bytes, prior.bytes.size()) };
          case null {};
        };
        blobs := blobs.filter(func(item) { item.path != upload.path }).concat([record]);
        total_bytes += Nat.toNat64(assembled.size());
        blob_uploaded_at := blob_uploaded_at.filter(func((p, _) : (Text, Int)) : Bool { p != upload.path }).concat([(upload.path, Time.now())]);
        switch (categoryForPath(upload.path), clubIdFromPath(upload.path)) {
          case (?category, ?clubId) { recordUsage(clubId, category, upload.total_size) };
          case _ {};
        };
        pending_uploads := pending_uploads.filter(func(item) { item.id != upload_id });
        #Ok({
          path = upload.path;
          content_hash;
          content_length = upload.total_size;
        })
      };
    }
  };

  public shared ({ caller }) func abort_upload(upload_id : Text) : async Result {
    auth(caller);
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
    switch (findBlob(path)) {
      case (?record) { ?record.content_hash };
      case null { null };
    }
  };

  // Club-domain pointer is governor-only; while unset, club-staff deletes
  // never authorize (fail closed).
  public shared ({ caller }) func set_club_domain_canister(canister_id : Principal) : async Result {
    auth(caller);
    if (not isGovernor<system>(caller)) return #Err("Governor required");
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
    let clubDomain : actor { has_club_staff_role : shared query (Principal, Text) -> async Bool } = actor (Principal.toText(cid));
    try {
      await clubDomain.has_club_staff_role(caller, clubId)
    } catch (_) {
      false
    }
  };

  public shared ({ caller }) func delete_blob(path : Text) : async Result {
    auth(caller);
    switch (findBlob(path)) {
      case null { #Err("Unknown blob") };
      case (?record) {
        if (not record.owner.equal(caller) and not isGovernor<system>(caller)) {
          if (not (await isClubStaffForPath(caller, path))) {
            return #Err("Owner, club staff, or governor required");
          };
        };
        blobs := blobs.filter(func(item) { item.path != path });
        total_bytes := subBytes(total_bytes, record.bytes.size());
        blob_uploaded_at := blob_uploaded_at.filter(func((p, _) : (Text, Int)) : Bool { p != path });
        #Ok
      };
    }
  };

  // Serves ciphertext only — see the module header. No authorization here:
  // read access is enforced at vetKey derivation time on pii_access_control.
  public query func http_request(request : HttpRequest) : async HttpResponse {
    if (request.method != "GET") {
      return { status_code = 405; headers = []; body = "" };
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
    switch (findBlob(path)) {
      case null { { status_code = 404; headers = []; body = "" } };
      case (?record) {
        {
          status_code = 200;
          headers = [
            ("content-type", record.mime),
            ("cache-control", "public, max-age=31536000, immutable"),
          ];
          body = record.bytes;
        };
      };
    }
  };

  type Usage = {
    total_bytes : Nat64;
    capacity_limit_bytes : Nat64;
    accepting_uploads : Bool;
  };

  // Sharding: the app reads this to skip full stores and to show fullness in
  // Placement Settings. Public query — reveals only byte totals.
  public query func get_usage() : async Usage {
    { total_bytes; capacity_limit_bytes = UploadPolicy.effectiveCapacity(capacity_limit_bytes); accepting_uploads = canReserve(1) and pending_uploads.size() < UploadPolicy.maxPending }
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
      blob_count = Nat.toNat64(blobs.size());
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
    conflicts += pending_uploads.filter(func(u : PendingUpload) : Bool = u.owner.equal(new)).size();
    if (conflicts > 0 and not allowMerge) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in media_blob_store");

    var changed = 0;

    let newBlobs = blobs.map(func(b : BlobRecord) : BlobRecord {
      if (b.owner.equal(old)) { changed += 1; { b with owner = new } } else b
    });

    let newPendingUploads = pending_uploads.map(func(u : PendingUpload) : PendingUpload {
      if (u.owner.equal(old)) { changed += 1; { u with owner = new } } else u
    });

    if (not dry_run) {
      blobs := newBlobs;
      pending_uploads := newPendingUploads;
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
    var checked = 0;
    for ((clubId, paths) in Map.entries(expiredByClub)) {
      if (checked < 50) {
        checked += 1;
        if ((await clubProStatus(clubId)) == ?false) {
          let doomed = Map.empty<Text, ()>();
          for (p in paths.values()) { Map.add(doomed, Text.compare, p, ()) };
          var freed : Nat = 0;
          for (b in blobs.values()) { if (Map.containsKey(doomed, Text.compare, b.path)) freed += b.bytes.size() };
          blobs := blobs.filter(func(b) { not Map.containsKey(doomed, Text.compare, b.path) });
          blob_uploaded_at := blob_uploaded_at.filter(func((p, _) : (Text, Int)) : Bool { not Map.containsKey(doomed, Text.compare, p) });
          total_bytes := subBytes(total_bytes, freed);
        };
      };
    };
  };
  transient let _retentionTimer = Timer.recurringTimer<system>(#seconds(86_400), sweepRetention);

};
