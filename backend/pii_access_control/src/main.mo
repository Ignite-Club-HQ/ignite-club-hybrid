/// PII Access Control Canister
/// Mediates access to personally identifiable information (PII) with
/// field-level access policies and an audit trail.
///
/// Encryption construction (vetKeys / IBE):
/// - The canister holds NO key material. Values are encrypted client-side
///   with identity-based encryption (IBE) under the subnet's vetKD master
///   key: the writer derives this canister's IBE public key offline (master
///   public key -> canister key -> context subkey) and encrypts to the
///   identity `pii_id ++ "\u{1F}" ++ field_id` — no canister call needed to
///   write, so first registration of a record needs no key ceremony.
/// - Readers call `get_encrypted_pii_vetkeys_batch`, which enforces the
///   exact same authorization as the old decrypt path (governor, domain
///   owner, granted readers, verified guardians, club-scoped read grants
///   verified live via club_domain) and only then relays the vetKey for the
///   record's identity, encrypted under the caller's one-time transport key.
///   The subnet never sees the raw key; the canister only relays the
///   still-encrypted key and never sees plaintext.
/// - The frontend (@icp-sdk/vetkeys) does all cryptography: transport keys,
///   decryptAndVerify, IBE encrypt/decrypt. The Motoko vetKeys library
///   deliberately exposes only the management-canister relay.
/// - VETKD_KEY_NAME selects the subnet key ("test_key_1" local, "key_1"
///   production). It is captured at first install and immutable for the life
///   of the derived keys — the deploy script MUST set it before first use.
/// - `vetkd_derive_key` costs cycles per derivation; readers cache derived
///   vetKeys client-side per session, so each (pii_id, field_id) costs one
///   derivation per reader session.

import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import ManagementCanister "mo:ic-vetkeys/ManagementCanister";

persistent actor class Main(governorInit : Principal) {
  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };


  // ==================== Types ====================

  public type EncryptedPii = {
    pii_id : Text;
    field_id : Text;
    ciphertext : [Nat8];
    nonce : [Nat8];
    master_key_id : Text;
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

  // ==================== Constants ====================

  // vetKD domain separator (context) and the marker stored in each record's
  // legacy master_key_id field. Both are immutable once any record exists —
  // changing either makes stored ciphertext undecryptable. Kept as functions
  // (not actor-level constants) because --enhanced-migration forbids
  // initializers on actor-level declarations.
  func vetkdContext() : Blob { Text.encodeUtf8("ignite-pii-v1") };
  func vetkeySchemeId() : Text { "vetkey-ibe-v1" };

  // The vetKD key id, read from the VETKD_KEY_NAME canister environment
  // variable ("test_key_1" local, "key_1" production). The deploy script
  // MUST set it at first install and never change it afterwards — the key
  // name feeds key derivation, so changing it makes every stored record
  // undecryptable. Read per call (system capability is only available
  // inside shared methods).
  func vetkdKeyId<system>() : ManagementCanister.VetKdKeyid {
    let keyName = Runtime.envVar<system>("VETKD_KEY_NAME") ?? "test_key_1";
    { curve = #bls12_381_g2; name = keyName }
  };

  // IBE identity for a record: pii_id, unit separator, field_id. Neither id
  // may contain the separator (ids are UUIDs / "prefix:..." slugs).
  func ibeIdentity(pii_id : Text, field_id : Text) : Blob {
    Text.encodeUtf8(pii_id # "\u{1F}" # field_id)
  };

  // ==================== State ====================

  // Enhanced orthogonal persistence: state is declared without initializers
  // and seeded by the migration chain in src/backend/migrations (initial
  // bootstrap 20260913_000000.mo).
  var pii_records : [PiiRecord];
  var audit_log : [AuditRecord];

  var metadata_version : Nat32;
  var governor : Principal;

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };

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

  // Resolves club-scoped read access for a batch: collects the club ids
  // granting any requested record, then verifies the caller's membership in
  // each via club_domain (one inter-canister round per club, not per record).
  func resolveAllowedClubs(caller : Principal, pii_ids : [Text], field_id : Text) : async [Text] {
    var clubIds : [Text] = [];
    for (pii_id in pii_ids.values()) {
      for (cid in grantClubIds(pii_id, field_id).values()) {
        if (not clubIds.any(func(c) = c == cid)) {
          clubIds := clubIds.concat([cid]);
        };
      };
    };
    if (clubIds.size() > 0) {
      await clubsWhereStaff(caller, clubIds)
    } else {
      []
    }
  };

  // ==================== vetKeys (IBE) ====================

  // The canister's IBE public key for the vetKD context. Not sensitive —
  // anyone can derive it offline from the subnet master public key — so no
  // authorization is required. Writers use it to encrypt new records without
  // any canister call; readers use it to verify derived vetKeys.
  public shared func pii_vetkey_verification_key() : async Blob {
    await ManagementCanister.vetKdPublicKey(null, vetkdContext(), vetkdKeyId<system>());
  };

  // Relays the caller's vetKeys for the requested records, each encrypted
  // under the caller's one-time transport key. Authorization is identical to
  // the ciphertext read path: governor, domain owner, granted reader,
  // verified guardian, or club-scoped grant (verified live via club_domain).
  // Result is index-aligned with `pii_ids`: null where the caller has no
  // access or the record does not exist. Every attempt is audited.
  // Capped at 25: each derivation is a paid vetkd_derive_key call.
  public shared ({ caller }) func get_encrypted_pii_vetkeys_batch(
    pii_ids : [Text],
    field_id : Text,
    transport_public_key : Blob
  ) : async { #Ok : [?Blob]; #Err : Text } {
    auth(caller);
    if (pii_ids.size() > 25) return #Err("Batch too large");
    if (transport_public_key.size() == 0) return #Err("Invalid transport key");
    let allowedClubs = await resolveAllowedClubs(caller, pii_ids, field_id);
    var out : [?Blob] = [];
    for (pii_id in pii_ids.values()) {
      switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
        case (?r) {
          let allowed = can_read(caller, r) or canReadViaClub(r, allowedClubs);
          log_audit(caller, pii_id, field_id, "vetkey_derive", allowed, "PII vetKey derivation");
          if (allowed) {
            let encryptedKey = await ManagementCanister.vetKdDeriveKey(
              ibeIdentity(pii_id, field_id), vetkdContext(), vetkdKeyId<system>(), transport_public_key
            );
            out := out.concat([?encryptedKey]);
          } else {
            out := out.concat([null]);
          };
        };
        case null {
          log_audit(caller, pii_id, field_id, "vetkey_derive", false, "PII vetKey derivation");
          out := out.concat([null]);
        };
      };
    };
    #Ok(out)
  };

  // ==================== Per-club photo key ====================

  // Club photos are IBE-encrypted to ONE identity per club
  // (`clubmedia:<club_id>` U+001F `blob`), so a member derives a single key
  // per club per session instead of one paid derivation per photo. No record
  // is stored: access is decided live by club_domain.is_club_member (or the
  // governor). Fails closed while club_domain_canister is unset or the call
  // errors.
  public query func club_media_lock_version() : async Nat { 1 };

  public shared ({ caller }) func get_club_media_vetkey(
    club_id : Text,
    transport_public_key : Blob
  ) : async { #Ok : Blob; #Err : Text } {
    auth(caller);
    if (club_id.size() == 0 or club_id.size() > 64 or Text.contains(club_id, #char '\u{1F}')) return #Err("Invalid club");
    if (transport_public_key.size() == 0) return #Err("Invalid transport key");
    var allowed = isGovernor(caller);
    if (not allowed) {
      switch (club_domain_canister) {
        case null {};
        case (?cid) {
          let clubDomain : actor { is_club_member : shared query (Principal, Text) -> async Bool } = actor (Principal.toText(cid));
          try { allowed := await clubDomain.is_club_member(caller, club_id) } catch (_) {};
        };
      };
    };
    let pii_id = "clubmedia:" # club_id;
    log_audit(caller, pii_id, "blob", "vetkey_derive", allowed, "Club media vetKey derivation");
    if (not allowed) return #Err("Not a member of this club");
    let encryptedKey = await ManagementCanister.vetKdDeriveKey(
      ibeIdentity(pii_id, "blob"), vetkdContext(), vetkdKeyId<system>(), transport_public_key
    );
    #Ok(encryptedKey)
  };

  // ==================== Public Methods ====================

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };

  // Stores a client-encrypted PII field. The caller encrypts offline (IBE
  // under the canister's derived public key, identity = pii_id ++ SEP ++
  // field_id) — the canister never sees plaintext and holds no keys. The
  // legacy nonce/master_key_id fields are kept for record-shape stability
  // and set to empty / the vetKeys scheme marker.
  public shared ({ caller }) func register_pii(
    pii_id : Text,
    field_id : Text,
    ciphertext : [Nat8],
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

    let now = now_ns();

    let record : PiiRecord = {
      pii_id = pii_id;
      field_id = field_id;
      ciphertext = ciphertext;
      nonce = [];
      master_key_id = vetkeySchemeId();
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
      nonce = [];
      master_key_id = vetkeySchemeId();
    })
  };

  // Batch read of encrypted PII fields. The canister returns ciphertext only
  // — decryption happens client-side with the reader's vetKey. Records the
  // caller cannot read are omitted rather than failing the whole batch;
  // every attempt is audited. Does not bump access_count/last_accessed.
  public shared ({ caller }) func get_encrypted_pii_batch(
    pii_ids : [Text],
    field_id : Text,
    operation : Text,
    purpose : Text
  ) : async { #Ok : [EncryptedPii]; #Err : Text } {
    auth(caller);
    if (pii_ids.size() > 100) return #Err("Batch too large");
    let allowedClubs = await resolveAllowedClubs(caller, pii_ids, field_id);
    var out : [EncryptedPii] = [];
    for (pii_id in pii_ids.values()) {
      switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
        case (?r) {
          let allowed = can_read(caller, r) or canReadViaClub(r, allowedClubs);
          log_audit(caller, pii_id, field_id, operation, allowed, purpose);
          if (allowed) {
            out := out.concat([{
              pii_id = r.pii_id;
              field_id = r.field_id;
              ciphertext = r.ciphertext;
              nonce = r.nonce;
              master_key_id = r.master_key_id;
            }]);
          };
        };
        case null {
          log_audit(caller, pii_id, field_id, operation, false, purpose);
        };
      };
    };
    #Ok(out)
  };

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

  // Sets the club_domain canister used to verify club membership for
  // club-scoped read grants. Governor only; must be called by the deploy
  // script after all canisters are created.
  public shared ({ caller }) func set_club_domain_canister(canister : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (canister.equal(Principal.anonymous())) return #Err("Invalid canister");
    club_domain_canister := ?canister;
    #Ok
  };

  // Grants every member of `club_id` (verified via club_domain at read
  // time) read access to one record — e.g. a child's name so coaches can
  // render event rosters. Governor or the record's domain owner only.
  public shared ({ caller }) func grant_pii_read_club(pii_id : Text, field_id : Text, club_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (club_id == "") return #Err("Invalid club_id");
    switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
      case null { #Err("PII not found") };
      case (?r) {
        if (not isGovernor(caller) and not caller.equal(r.domain_owner)) return #Err("Domain owner authorization required");
        if (not club_read_grants.any(func(g) = g.pii_id == pii_id and g.field_id == field_id and g.club_id == club_id)) {
          club_read_grants := club_read_grants.concat([{ pii_id; field_id; club_id }]);
        };
        log_audit(caller, pii_id, field_id, "grant_read_club", true, "Club read access granted");
        #Ok
      };
    }
  };

  // Removes a club-scoped read grant. Governor or domain owner only.
  public shared ({ caller }) func revoke_pii_read_club(pii_id : Text, field_id : Text, club_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
      case null { #Err("PII not found") };
      case (?r) {
        if (not isGovernor(caller) and not caller.equal(r.domain_owner)) return #Err("Domain owner authorization required");
        club_read_grants := club_read_grants.filter(func(g) = not (g.pii_id == pii_id and g.field_id == field_id and g.club_id == club_id));
        log_audit(caller, pii_id, field_id, "revoke_read_club", true, "Club read access revoked");
        #Ok
      };
    }
  };

  // Removes every club-scoped read grant for a permanently deleted club.
  // Called by club_domain's permanent-delete / 30-day auto-purge fan-out;
  // only the configured club_domain canister may call (fail-closed while
  // unset). The encrypted records themselves stay — they are parent- or
  // event-creator-owned, not club-owned — but without a grant no club
  // member can ever derive a vetKey for them again.
  public shared ({ caller }) func purge_club_grants(club_id : Text) : async { #Ok : Nat32; #Err : Text } {
    switch (club_domain_canister) {
      case null { return #Err("club_domain canister not configured") };
      case (?c) { if (not c.equal(caller)) return #Err("club_domain only") };
    };
    if (club_id == "") return #Err("Invalid club_id");
    let before = club_read_grants.size();
    club_read_grants := club_read_grants.filter(func(g) = g.club_id != club_id);
    log_audit(caller, club_id, "*", "purge_club_grants", true, "Club read grants purged for deleted club");
    #Ok(Nat.toNat32(before - club_read_grants.size()))
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

        // Remove the record (cryptographic erasure)
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

  public shared ({ caller }) func emergency_shutdown() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) { return #Err("Governor only") };

    // Zeroize state. There are no canister-held keys to destroy — vetKeys
    // live with the subnet — so wiping the records and grants is the
    // complete erasure.
    pii_records := [];
    audit_log := [];
    guardian_relationships := [];
    club_read_grants := [];

    log_audit(caller, "system", "emergency", "shutdown", true, "Emergency shutdown executed");
    #Ok
  };

  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  //
  // Covered: PiiRecord.domain_owner, PiiRecord.readers (array, dedupe on
  // collision), GuardianRelationship.guardian (merges `children` into the
  // NEW row if both old and new already have one), AuditRecord.requesting_principal.
  // Not touched: governor (governor variable itself), club_domain_canister
  // (canister wiring), ClubReadGrant.club_id / PiiRecord.pii_id / field_id /
  // GuardianRelationship.children (content/club ids, not user identities).
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Forbidden");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (old.equal(new)) return #Err("old and new principal must differ");
    if (isGovernor(old)) return #Err("Cannot rekey the governor");

    // Conflict guard: non-ephemeral records already referencing `new`.
    // (GuardianRelationship is excluded here: both-exist is a merge, not a
    // conflict, per spec.)
    var conflicts = 0;
    conflicts += pii_records.filter(func(r : PiiRecord) : Bool = r.domain_owner.equal(new) or r.readers.any(func(p : Principal) : Bool = p.equal(new))).size();
    conflicts += audit_log.filter(func(a : AuditRecord) : Bool = a.requesting_principal.equal(new)).size();
    if (conflicts > 0) return #Err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in pii_access_control");

    var changed = 0;

    let newPiiRecords = pii_records.map(func(r : PiiRecord) : PiiRecord {
      var out = r;
      var touched = false;
      if (out.domain_owner.equal(old)) { out := { out with domain_owner = new }; touched := true };
      if (out.readers.any(func(p : Principal) : Bool = p.equal(old))) {
        let hasNew = out.readers.any(func(p : Principal) : Bool = p.equal(new));
        var newReaders : [Principal] = [];
        for (p in out.readers.values()) {
          if (p.equal(old)) {
            if (not hasNew and not newReaders.any(func(q : Principal) : Bool = q.equal(new))) { newReaders := newReaders.concat([new]) };
          } else if (not newReaders.any(func(q : Principal) : Bool = q.equal(p))) {
            newReaders := newReaders.concat([p]);
          };
        };
        out := { out with readers = newReaders };
        touched := true;
      };
      if (touched) { changed += 1 };
      out
    });

    let newAuditLog = audit_log.map(func(a : AuditRecord) : AuditRecord {
      if (a.requesting_principal.equal(old)) { changed += 1; { a with requesting_principal = new } } else { a }
    });

    // Guardian relationships: merge `children` into the NEW row if both old
    // and new already exist; otherwise just rename old's guardian to new.
    let oldGuardian = guardian_relationships.find(func(g : GuardianRelationship) : Bool = g.guardian.equal(old));
    let newGuardian = guardian_relationships.find(func(g : GuardianRelationship) : Bool = g.guardian.equal(new));
    let newGuardianRelationships = switch (oldGuardian) {
      case (?og) {
        changed += 1;
        switch (newGuardian) {
          case (?ng) {
            var mergedChildren = ng.children;
            for (c in og.children.values()) {
              if (not mergedChildren.any(func(x : Text) : Bool = x == c)) { mergedChildren := mergedChildren.concat([c]) };
            };
            guardian_relationships
              .filter(func(g : GuardianRelationship) : Bool = not g.guardian.equal(old))
              .map(func(g : GuardianRelationship) : GuardianRelationship = if (g.guardian.equal(new)) { { g with children = mergedChildren } } else { g });
          };
          case null {
            guardian_relationships.map(func(g : GuardianRelationship) : GuardianRelationship = if (g.guardian.equal(old)) { { g with guardian = new } } else { g });
          };
        };
      };
      case null { guardian_relationships };
    };

    if (not dry_run) {
      pii_records := newPiiRecords;
      audit_log := newAuditLog;
      guardian_relationships := newGuardianRelationships;
    };

    #Ok(changed)
  };
}
