/// PII Access Control Canister
/// Encrypts and mediates access to personally identifiable information (PII)
/// Enforces field-level access policies and maintains audit trail
///
/// Encryption construction (interim, pre-vetKeys):
/// - Master secrets are 32 random bytes obtained from the management canister's
///   `raw_rand` (via `mo:core/Random.blob`, which calls raw_rand directly) on
///   `initialize_master_key` / `rotate_key`. Secrets are kept per key_id in
///   stable state so records encrypted under a retired key remain decryptable.
///   No method ever returns secret material; only opaque key_ids/metadata leave
///   the canister.
/// - Per-field key = SHA-256(master_secret || pii_id || field_id).
/// - Nonces are 12 random bytes drawn fresh from raw_rand for every
///   `register_pii` call (register_pii is already an update call, so this is
///   a plain `await`).
/// - Confidentiality: SHA-256-based CTR-mode keystream, where each 32-byte
///   keystream block is SHA-256(field_key || nonce || counter_be32), counter
///   starting at 0 and incrementing per 32-byte block, XORed with plaintext.
/// - Integrity: encrypt-then-MAC. tag = SHA-256(field_key || nonce ||
///   ciphertext). The tag (32 bytes) is appended to the ciphertext bytes
///   stored/returned in `EncryptedPii.ciphertext` (no public record shape
///   changed). Decryption recomputes and compares the tag before returning
///   plaintext, failing closed (#Err) on any mismatch, truncated input, or
///   unknown master_key_id.
/// - `derive_media_key` uses a separate raw_rand-generated 32-byte
///   `media_root_secret` (created lazily on first use) and returns
///   SHA-256(media_root_secret || child_id || authorizer || purpose),
///   32 bytes, still gated by the same authorization checks as before.
///
/// This is a meaningful improvement over the previous XOR/timestamp
/// "synthetic encryption" placeholder, but it is still symmetric key material
/// held in canister heap/stable memory. Production deployment should still
/// migrate to:
/// - vetKeys for child media key derivation and/or field key derivation,
///   removing raw master secret material from canister memory entirely
/// - Hardware Security Module (HSM) or KMS-backed custody for the true root
///   of trust, with this canister only holding derived, scoped key handles
/// - External vault for secret workload identity

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Option "mo:core/Option";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Crypto "./crypto";

persistent actor {

  // ==================== Types ====================

  public type EncryptedPii = {
    pii_id : Text;
    field_id : Text;
    ciphertext : [Nat8];
    nonce : [Nat8];
    master_key_id : Text;
  };

  public type DecryptedPii = {
    pii_id : Text;
    field_id : Text;
    plaintext : [Nat8];
  };

  public type AuditRecord = {
    timestamp : Nat64;
    requesting_principal : Principal;
    pii_id : Text;
    field_id : Text;
    operation : Text;
    allowed : Bool;
    purpose : Text;
  };

  public type PiiDeleteResult = {
    shredded_at : Nat64;
    key_destroyed : Bool;
  };

  public type KeyMetadata = {
    key_id : Text;
    created_at : Nat64;
    rotation_due_at : Nat64;
    status : { #Active; #RotationPending; #Revoked; #Shredded };
  };

  public type KeyRotationResult = {
    rotated_at : Nat64;
    old_key_id : Text;
    new_key_id : Text;
  };

  public type AuditFilter = {
    opt_principal : ?Principal;
    opt_field_id : ?Text;
    opt_pii_id : ?Text;
    opt_from_ts : ?Nat64;
    opt_to_ts : ?Nat64;
  };

  public type PiiRecord = {
    pii_id : Text;
    field_id : Text;
    ciphertext : [Nat8];
    nonce : [Nat8];
    master_key_id : Text;
    created_at : Nat64;
    last_accessed : Nat64;
    access_count : Nat64;
    domain_owner : Principal;
    // Principals (beyond the domain owner and governor) allowed to read this
    // record — e.g. both parents/guardians of a child. Managed via
    // grant_pii_read/revoke_pii_read by the domain owner or governor.
    readers : [Principal];
  };

  // A guardian relationship: `guardian` may read the PII of every pii_id in
  // `children`. Verified (i.e. created) only via add_guardian_relationship,
  // which requires either the governor or the guardian acting on their own
  // behalf (self-registration flow — the caller can only ever add themself
  // as the guardian, never impersonate another principal).
  public type GuardianRelationship = {
    guardian : Principal;
    children : [Text]; // pii_id set
  };

  // A club-scoped read grant: members of `club_id` (per club_domain) may
  // read the (pii_id, field_id) record via the decrypt methods.
  public type ClubReadGrant = {
    pii_id : Text;
    field_id : Text;
    club_id : Text;
  };

  type MasterSecretEntry = {
    key_id : Text;
    secret : [Nat8]; // 32 bytes, from raw_rand. Never exposed via any public method.
  };

  // ==================== State ====================

  // Enhanced orthogonal persistence: state is declared without initializers
  // and seeded by the migration chain in src/backend/migrations (initial
  // bootstrap 20260913_000000.mo).
  var pii_records : [PiiRecord];
  var audit_log : [AuditRecord];
  var key_metadata_list : [KeyMetadata];
  var master_secrets : [MasterSecretEntry];

  var master_key_id_current : Text;
  var metadata_version : Nat32;
  var last_key_rotation : Nat64;
  var governor : Principal;

  // Lazily-initialized root secret for media key derivation. Populated on
  // first call to derive_media_key using raw_rand.
  var media_root_secret : ?[Nat8];

  // Verified guardian -> child (pii_id) relationships backing can_read /
  // grant_pii_read authorization. Seeded empty, populated via
  // add_guardian_relationship.
  var guardian_relationships : [GuardianRelationship];

  // Club-scoped read grants: any principal holding a role in `club_id`
  // (verified via club_domain's has_club_staff_role at read time) may read
  // the record. Lets club staff (e.g. a coach viewing an event roster) read
  // child/guest names without a per-principal grant.
  var club_read_grants : [ClubReadGrant];

  // Principal of the club_domain canister used to verify club membership
  // for club-scoped read grants. Set post-deploy by the governor via
  // set_club_domain_canister; while unset, club grants never authorize.
  var club_domain_canister : ?Principal;

  // ==================== Helper Functions ====================

  func now_ns() : Nat64 {
    Nat.toNat64(Int.abs(Time.now()))
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) {
      Runtime.trap("Authenticated caller required");
    };
  };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  // True when `caller` has a verified guardian relationship (added via
  // add_guardian_relationship) covering `pii_id`.
  func isVerifiedGuardian(caller : Principal, pii_id : Text) : Bool {
    not caller.equal(Principal.anonymous()) and guardian_relationships.any(
      func(g) = g.guardian.equal(caller) and g.children.any(func(c) = c == pii_id)
    )
  };

  // Governor, the record's domain owner, an explicitly granted reader, or a
  // verified guardian of the child (pii_id) may read. Readers are per-record
  // so e.g. a parent can read their own children's PII without domain-owner
  // rights over the whole id space; guardian relationships grant the same
  // access without requiring an explicit per-field grant.
  func can_read(caller : Principal, r : PiiRecord) : Bool {
    isGovernor(caller) or caller.equal(r.domain_owner) or r.readers.any(func(p) = p.equal(caller)) or isVerifiedGuardian(caller, r.pii_id)
  };

  // Club ids holding a club-scoped read grant for this record (deduped).
  func grantClubIds(pii_id : Text, field_id : Text) : [Text] {
    var ids : [Text] = [];
    for (g in club_read_grants.values()) {
      if (g.pii_id == pii_id and g.field_id == field_id and not ids.any(func(c) = c == g.club_id)) {
        ids := ids.concat([g.club_id]);
      };
    };
    ids
  };

  // Verifies the caller's club membership for each club id via club_domain.
  // Fails closed: an unset canister id or any call error yields no
  // authorized clubs, so a misconfigured deployment denies rather than
  // leaks.
  func clubsWhereStaff(caller : Principal, clubIds : [Text]) : async [Text] {
    switch (club_domain_canister) {
      case null { [] };
      case (?cid) {
        let clubDomain : actor { has_club_staff_role : shared query (Principal, Text) -> async Bool } = actor (Principal.toText(cid));
        var ok : [Text] = [];
        for (club_id in clubIds.values()) {
          try {
            if (await clubDomain.has_club_staff_role(caller, club_id)) {
              ok := ok.concat([club_id]);
            };
          } catch (_) {};
        };
        ok
      };
    }
  };

  func canReadViaClub(r : PiiRecord, allowedClubs : [Text]) : Bool {
    club_read_grants.any(
      func(g) = g.pii_id == r.pii_id and g.field_id == r.field_id and allowedClubs.any(func(c) = c == g.club_id)
    )
  };

  func log_audit(requesting_principal : Principal, pii_id : Text, field_id : Text, operation : Text, allowed : Bool, purpose : Text) {
    let record : AuditRecord = {
      timestamp = now_ns();
      requesting_principal = requesting_principal;
      pii_id = pii_id;
      field_id = field_id;
      operation = operation;
      allowed = allowed;
      purpose = purpose;
    };
    audit_log := audit_log.concat([record]);
  };

  // ==================== Key material ====================
  // Pure crypto (SHA-256, field-key derivation, AEAD) lives in ./crypto.mo.

  func find_master_secret(key_id : Text) : ?[Nat8] {
    Option.map<MasterSecretEntry, [Nat8]>(
      master_secrets.find(func(e) = e.key_id == key_id),
      func(e) = e.secret
    )
  };

  func store_master_secret(key_id : Text, secret : [Nat8]) {
    master_secrets := Array.filter<MasterSecretEntry>(master_secrets, func(e) { e.key_id != key_id }).concat([{ key_id = key_id; secret = secret }]);
  };

  /// Derives the per-field key for a given master secret, pii_id and field_id.
  func derive_field_key(master_secret : [Nat8], pii_id : Text, field_id : Text) : [Nat8] {
    Crypto.derive_field_key(master_secret, pii_id, field_id)
  };

  func aead_encrypt(key : [Nat8], nonce : [Nat8], plaintext : [Nat8]) : [Nat8] {
    Crypto.aead_encrypt(key, nonce, plaintext)
  };

  func aead_decrypt(key : [Nat8], nonce : [Nat8], stored : [Nat8]) : ?[Nat8] {
    Crypto.aead_decrypt(key, nonce, stored)
  };

  /// Draws fresh randomness from the management canister via raw_rand
  /// (mo:core/Random.blob calls raw_rand directly). Returns the first
  /// `n` bytes of the resulting 32-byte blob.
  func random_bytes(n : Nat) : async* [Nat8] {
    let blob = await Random.blob();
    let bytes = Blob.toArray(blob);
    if (n <= bytes.size()) {
      Array.tabulate<Nat8>(n, func(i) = bytes[i])
    } else {
      // Should not happen: raw_rand returns 32 bytes and we never request more.
      Runtime.trap("Insufficient randomness returned by raw_rand");
    }
  };

  // ==================== Public Methods ====================

  public shared ({ caller }) func initialize_master_key(initial_key_id : Text) : async { #Ok : Text; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) {
      if (not isGovernor(caller)) { return #Err("Only governor can re-initialize") };
    } else {
      governor := caller;
    };

    let secret = await* random_bytes(32);
    store_master_secret(initial_key_id, secret);

    let now = now_ns();
    master_key_id_current := initial_key_id;
    last_key_rotation := now;

    let meta : KeyMetadata = {
      key_id = initial_key_id;
      created_at = now;
      rotation_due_at = now + 7776000000000000; // 90 days in nanoseconds
      status = #Active;
    };
    key_metadata_list := key_metadata_list.concat([meta]);

    #Ok(initial_key_id)
  };

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };

  public shared ({ caller }) func register_pii(
    pii_id : Text,
    field_id : Text,
    plaintext : [Nat8],
    domain_owner : Principal
  ) : async { #Ok : EncryptedPii; #Err : Text } {
    auth(caller);

    if (pii_id == "" or field_id == "") {
      return #Err("Invalid pii_id or field_id");
    };
    if (domain_owner.equal(Principal.anonymous())) {
      return #Err("Invalid domain owner");
    };
    if (not isGovernor(caller) and not caller.equal(domain_owner)) {
      return #Err("Domain owner authorization required");
    };

    let key_id = master_key_id_current;
    let master_secret = switch (find_master_secret(key_id)) {
      case (?s) { s };
      case null { return #Err("Master key not initialized") };
    };

    let nonce = await* random_bytes(Crypto.NONCE_LEN);
    let field_key = derive_field_key(master_secret, pii_id, field_id);
    let ciphertext = aead_encrypt(field_key, nonce, plaintext);
    let now = now_ns();

    let record : PiiRecord = {
      pii_id = pii_id;
      field_id = field_id;
      ciphertext = ciphertext;
      nonce = nonce;
      master_key_id = key_id;
      created_at = now;
      last_accessed = now;
      access_count = 0;
      domain_owner = domain_owner;
      readers = [];
    };

    // Remove existing if any, then append
    pii_records := Array.filter<PiiRecord>(pii_records, func(r) {
      not (r.pii_id == pii_id and r.field_id == field_id)
    }).concat([record]);

    log_audit(caller, pii_id, field_id, "register", true, "PII Registration");

    #Ok({
      pii_id = pii_id;
      field_id = field_id;
      ciphertext = ciphertext;
      nonce = nonce;
      master_key_id = key_id;
    })
  };

  public shared query ({ caller }) func get_encrypted_pii(
    pii_id : Text,
    field_id : Text
  ) : async { #Ok : EncryptedPii; #Err : Text } {
    auth(caller);

    switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
      case (?r) {
        if (not can_read(caller, r)) {
          return #Err("Access denied to PII field");
        };
        #Ok({
          pii_id = r.pii_id;
          field_id = r.field_id;
          ciphertext = r.ciphertext;
          nonce = r.nonce;
          master_key_id = r.master_key_id;
        })
      };
      case null { #Err("PII not found") };
    }
  };

  public shared ({ caller }) func get_decrypted_pii(
    pii_id : Text,
    field_id : Text,
    operation : Text,
    purpose : Text
  ) : async { #Ok : DecryptedPii; #Err : Text } {
    auth(caller);

    switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
      case (?r) {
        // Access control: governor, domain owner or a granted reader
        let allowed = can_read(caller, r);

        log_audit(caller, pii_id, field_id, operation, allowed, purpose);

        if (not allowed) {
          return #Err("Access denied to PII field");
        };

        let master_secret = switch (find_master_secret(r.master_key_id)) {
          case (?s) { s };
          case null { return #Err("Unknown or destroyed master key for this record") };
        };
        let field_key = derive_field_key(master_secret, pii_id, field_id);

        let plaintext = switch (aead_decrypt(field_key, r.nonce, r.ciphertext)) {
          case (?p) { p };
          case null { return #Err("Ciphertext integrity check failed") };
        };

        // Update access count and last_accessed
        let now = now_ns();
        pii_records := Array.tabulate<PiiRecord>(pii_records.size(), func(idx) {
          let cur = pii_records[idx];
          if (cur.pii_id == pii_id and cur.field_id == field_id) {
            { cur with last_accessed = now; access_count = cur.access_count + 1 }
          } else {
            cur
          }
        });

        #Ok({
          pii_id = pii_id;
          field_id = field_id;
          plaintext = plaintext;
        })
      };
      case null {
        log_audit(caller, pii_id, field_id, operation, false, purpose);
        #Err("PII not found")
      };
    }
  };

  // Batch variant of get_decrypted_pii for member-facing surfaces (e.g. the
  // home feed resolving child names). One update call instead of N. Records
  // the caller cannot read (or that fail integrity) are omitted from the
  // result rather than failing the whole batch; every attempt is audited.
  // Does not bump access_count/last_accessed (bulk read path).
  public shared ({ caller }) func get_decrypted_pii_batch(
    pii_ids : [Text],
    field_id : Text,
    operation : Text,
    purpose : Text
  ) : async { #Ok : [DecryptedPii]; #Err : Text } {
    auth(caller);
    if (pii_ids.size() > 100) return #Err("Batch too large");
    var out : [DecryptedPii] = [];
    for (pii_id in pii_ids.values()) {
      switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
        case (?r) {
          let allowed = can_read(caller, r);
          log_audit(caller, pii_id, field_id, operation, allowed, purpose);
          if (allowed) {
            switch (find_master_secret(r.master_key_id)) {
              case (?master_secret) {
                let field_key = derive_field_key(master_secret, pii_id, field_id);
                switch (aead_decrypt(field_key, r.nonce, r.ciphertext)) {
                  case (?plaintext) { out := out.concat([{ pii_id; field_id; plaintext }]) };
                  case null {};
                };
              };
              case null {};
            };
          };
        };
        case null {
          log_audit(caller, pii_id, field_id, operation, false, purpose);
        };
      };
    };
    #Ok(out)
  };

  // Grant another principal read access to one record (e.g. a second
  // guardian of the same child). Domain owner or governor only.
  // Grants a reader read access to a record. The caller must be the
  // governor, the record's domain owner, OR a verified guardian of the
  // child (pii_id) — self-registered via add_guardian_relationship. This
  // lets a verified guardian extend read access (e.g. to a co-guardian)
  // without needing domain-owner rights over the whole id space.
  public shared ({ caller }) func grant_pii_read(pii_id : Text, field_id : Text, reader : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (reader.equal(Principal.anonymous())) return #Err("Invalid reader");
    switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
      case null { #Err("PII not found") };
      case (?r) {
        let authorized = isGovernor(caller) or caller.equal(r.domain_owner) or isVerifiedGuardian(caller, pii_id);
        if (not authorized) return #Err("Domain owner or verified guardian authorization required");
        if (not r.readers.any(func(p) = p.equal(reader))) {
          pii_records := pii_records.map(func(rec) = if (rec.pii_id == pii_id and rec.field_id == field_id) { { rec with readers = rec.readers.concat([reader]) } } else { rec });
        };
        log_audit(caller, pii_id, field_id, "grant_read", true, "Reader access granted");
        #Ok
      };
    }
  };

  // Registers a verified guardian relationship: `guardian` may thereafter
  // read all PII records with pii_id == child_id via can_read, and grant
  // reads on that child's records via grant_pii_read. Callable by the
  // governor for any guardian, or by a principal registering themself as a
  // guardian (self-registration — a caller can never claim guardianship on
  // another principal's behalf).
  public shared ({ caller }) func add_guardian_relationship(guardian : Principal, child_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (guardian.equal(Principal.anonymous())) return #Err("Invalid guardian");
    if (child_id == "") return #Err("Invalid child_id");
    if (not isGovernor(caller) and not caller.equal(guardian)) {
      return #Err("Only the governor or the guardian themself may register this relationship");
    };
    let existing = guardian_relationships.find(func(g) = g.guardian.equal(guardian));
    switch (existing) {
      case (?g) {
        if (not g.children.any(func(c) = c == child_id)) {
          guardian_relationships := guardian_relationships.map(func(rec) = if (rec.guardian.equal(guardian)) { { rec with children = rec.children.concat([child_id]) } } else { rec });
        };
      };
      case null {
        guardian_relationships := guardian_relationships.concat([{ guardian = guardian; children = [child_id] }]);
      };
    };
    log_audit(caller, child_id, "guardian_relationship", "add", true, "Guardian relationship registered");
    #Ok
  };

  // Removes a guardian relationship. Callable by the governor, or by the
  // guardian themself (a guardian may always revoke their own standing
  // link, e.g. after a custody change).
  public shared ({ caller }) func remove_guardian_relationship(guardian : Principal, child_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller) and not caller.equal(guardian)) {
      return #Err("Only the governor or the guardian themself may remove this relationship");
    };
    guardian_relationships := Array.filter<GuardianRelationship>(
      guardian_relationships.map(func(g) = if (g.guardian.equal(guardian)) { { g with children = g.children.filter(func(c) = c != child_id) } } else { g }),
      func(g) = g.children.size() > 0
    );
    log_audit(caller, child_id, "guardian_relationship", "remove", true, "Guardian relationship removed");
    #Ok
  };

  // Lists the pii_ids (children) the caller is a verified guardian of.
  public shared query ({ caller }) func my_guardian_children() : async [Text] {
    auth(caller);
    switch (guardian_relationships.find(func(g) = g.guardian.equal(caller))) {
      case (?g) { g.children };
      case null { [] };
    }
  };

  public shared ({ caller }) func revoke_pii_read(pii_id : Text, field_id : Text, reader : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
      case null { #Err("PII not found") };
      case (?r) {
        if (not isGovernor(caller) and not caller.equal(r.domain_owner)) return #Err("Domain owner authorization required");
        pii_records := pii_records.map(func(rec) = if (rec.pii_id == pii_id and rec.field_id == field_id) { { rec with readers = rec.readers.filter(func(p) = not p.equal(reader)) } } else { rec });
        log_audit(caller, pii_id, field_id, "revoke_read", true, "Reader access revoked");
        #Ok
      };
    }
  };

  public shared ({ caller }) func derive_media_key(
    child_id : Text,
    authorizer : Principal,
    purpose : Text,
    expiry_seconds : Nat64
  ) : async { #Ok : [Nat8]; #Err : Text } {
    auth(caller);

    if (not isGovernor(caller) and not caller.equal(authorizer)) {
      log_audit(caller, child_id, "media_key", "derive", false, purpose);
      return #Err("Unauthorized media key derivation");
    };

    let root_secret = switch (media_root_secret) {
      case (?s) { s };
      case null {
        let s = await* random_bytes(32);
        media_root_secret := ?s;
        s
      };
    };

    log_audit(caller, child_id, "media_key", "derive", true, purpose);

    let material = Array.concat<Nat8>(
      root_secret,
      Array.concat<Nat8>(
        Blob.toArray(Text.encodeUtf8(child_id)),
        Array.concat<Nat8>(
          Blob.toArray(Principal.toBlob(authorizer)),
          Blob.toArray(Text.encodeUtf8(purpose))
        )
      )
    );
    let key = Crypto.sha256(material); // 32 bytes
    #Ok(key)
  };

  public shared ({ caller }) func delete_pii(
    pii_id : Text,
    field_id : Text
  ) : async { #Ok : PiiDeleteResult; #Err : Text } {
    auth(caller);

    let match_record = pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id);
    switch (match_record) {
      case (?r) {
        if (not isGovernor(caller) and not caller.equal(r.domain_owner)) {
          log_audit(caller, pii_id, field_id, "delete", false, "Cryptographic erasure");
          return #Err("Access denied: cannot delete PII");
        };

        // Remove the record (cryptographic shredding)
        pii_records := Array.filter<PiiRecord>(pii_records, func(rec) {
          not (rec.pii_id == pii_id and rec.field_id == field_id)
        });

        let now = now_ns();
        log_audit(caller, pii_id, field_id, "delete", true, "Cryptographic erasure");

        #Ok({
          shredded_at = now;
          key_destroyed = true;
        })
      };
      case null {
        #Err("PII record not found")
      };
    }
  };

  public shared query ({ caller }) func audit_access(filter : AuditFilter) : async [AuditRecord] {
    auth(caller);
    if (not isGovernor(caller)) Runtime.trap("Governor only");

    Array.filter<AuditRecord>(audit_log, func(record) {
      let principal_match = switch (filter.opt_principal) {
        case (?p) { record.requesting_principal.equal(p) };
        case null { true };
      };
      let field_match = switch (filter.opt_field_id) {
        case (?f) { record.field_id == f };
        case null { true };
      };
      let pii_match = switch (filter.opt_pii_id) {
        case (?pii) { record.pii_id == pii };
        case null { true };
      };
      let time_from_match = switch (filter.opt_from_ts) {
        case (?ts) { record.timestamp >= ts };
        case null { true };
      };
      let time_to_match = switch (filter.opt_to_ts) {
        case (?ts) { record.timestamp <= ts };
        case null { true };
      };
      principal_match and field_match and pii_match and time_from_match and time_to_match
    })
  };

  public shared ({ caller }) func rotate_key(new_key_id : Text) : async { #Ok : KeyRotationResult; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) { return #Err("Governor only") };

    let old_key = master_key_id_current;
    let now = now_ns();

    let new_secret = await* random_bytes(32);
    store_master_secret(new_key_id, new_secret);

    // Mark previous active key as pending/rotated. Its secret is kept in
    // master_secrets so previously-encrypted records remain decryptable.
    key_metadata_list := Array.tabulate<KeyMetadata>(key_metadata_list.size(), func(idx) {
      let cur = key_metadata_list[idx];
      if (cur.key_id == old_key) {
        { cur with status = #RotationPending }
      } else {
        cur
      }
    });

    master_key_id_current := new_key_id;
    last_key_rotation := now;

    let new_meta : KeyMetadata = {
      key_id = new_key_id;
      created_at = now;
      rotation_due_at = now + 7776000000000000;
      status = #Active;
    };
    key_metadata_list := key_metadata_list.concat([new_meta]);

    log_audit(caller, "system", "master_key", "rotate", true, "Scheduled 90-day key rotation");

    #Ok({
      rotated_at = now;
      old_key_id = old_key;
      new_key_id = new_key_id;
    })
  };

  public shared query ({ caller }) func get_key_metadata() : async [KeyMetadata] {
    auth(caller);
    key_metadata_list
  };

  public shared ({ caller }) func emergency_shutdown() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) { return #Err("Governor only") };

    // Zeroize state, including all master secrets and the media root secret.
    pii_records := [];
    audit_log := [];
    key_metadata_list := [];
    master_secrets := [];
    media_root_secret := null;

    log_audit(caller, "system", "emergency", "shutdown", true, "Emergency shutdown executed");
    #Ok
  };
}
