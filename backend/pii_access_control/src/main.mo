/// PII Access Control Canister
/// Encrypts and mediates access to personally identifiable information (PII)
/// Enforces field-level access policies and maintains audit trail
///
/// Production note: This uses synthetic encryption for lab testing.
/// Production deployment should integrate with:
/// - Hardware Security Module (HSM) or KMS for master key storage
/// - vetKeys for child media key derivation
/// - External vault for secret workload identity

import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Option "mo:core/Option";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";

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
  };

  // ==================== State ====================

  var pii_records : [PiiRecord] = [];
  var audit_log : [AuditRecord] = [];
  var key_metadata_list : [KeyMetadata] = [];

  var master_key_id_current : Text = "master-key-2026-09-13";
  var metadata_version : Nat32 = 1;
  var last_key_rotation : Nat64 = 0;
  var governor : Principal = Principal.anonymous();

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

  /// Simple XOR-based obfuscation for lab synthetic encryption
  /// Production: Replace with AES-256-GCM via external KMS or HSM
  func synthetic_encrypt(plaintext : [Nat8], nonce : [Nat8]) : [Nat8] {
    if (nonce.size() == 0) { return plaintext };
    Array.tabulate<Nat8>(plaintext.size(), func(i) {
      let xor_byte = nonce[i % nonce.size()];
      plaintext[i] ^ xor_byte
    })
  };

  func synthetic_decrypt(ciphertext : [Nat8], nonce : [Nat8]) : [Nat8] {
    synthetic_encrypt(ciphertext, nonce)
  };

  func generate_nonce() : [Nat8] {
    let ts = now_ns();
    let ts_nat = Nat64.toNat(ts);
    [
      Nat.toNat8(ts_nat % 256),
      Nat.toNat8((ts_nat / 256) % 256),
      Nat.toNat8((ts_nat / 65536) % 256),
      Nat.toNat8((ts_nat / 16777216) % 256),
    ]
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

  // ==================== Public Methods ====================

  public shared ({ caller }) func initialize_master_key(initial_key_id : Text) : async { #Ok : Text; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) {
      if (not isGovernor(caller)) { return #Err("Only governor can re-initialize") };
    } else {
      governor := caller;
    };

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

    let nonce = generate_nonce();
    let ciphertext = synthetic_encrypt(plaintext, nonce);
    let now = now_ns();

    let record : PiiRecord = {
      pii_id = pii_id;
      field_id = field_id;
      ciphertext = ciphertext;
      nonce = nonce;
      master_key_id = master_key_id_current;
      created_at = now;
      last_accessed = now;
      access_count = 0;
      domain_owner = domain_owner;
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
      master_key_id = master_key_id_current;
    })
  };

  public shared query ({ caller }) func get_encrypted_pii(
    pii_id : Text,
    field_id : Text
  ) : async { #Ok : EncryptedPii; #Err : Text } {
    auth(caller);

    switch (pii_records.find(func(r) = r.pii_id == pii_id and r.field_id == field_id)) {
      case (?r) {
        if (not isGovernor(caller) and not caller.equal(r.domain_owner)) {
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
        // Access control: caller must be governor or domain owner
        let allowed = isGovernor(caller) or caller.equal(r.domain_owner);

        log_audit(caller, pii_id, field_id, operation, allowed, purpose);

        if (not allowed) {
          return #Err("Access denied to PII field");
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

        let plaintext = synthetic_decrypt(r.ciphertext, r.nonce);

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

    log_audit(caller, child_id, "media_key", "derive", true, purpose);

    // Lab synthetic key derivation
    let ts = now_ns();
    let ts_nat = Nat64.toNat(ts);
    let key : [Nat8] = [
      Nat.toNat8(ts_nat % 256),
      Nat.toNat8((ts_nat / 256) % 256),
      Nat.toNat8((ts_nat / 65536) % 256),
      Nat.toNat8((ts_nat / 16777216) % 256),
      Nat.toNat8(child_id.size() % 256),
      0x4B, 0x45, 0x59, // 'KEY'
    ];
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

    // Mark previous active key as pending/rotated
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

    // Zeroize state
    pii_records := [];
    audit_log := [];
    key_metadata_list := [];

    log_audit(caller, "system", "emergency", "shutdown", true, "Emergency shutdown executed");
    #Ok
  };
}
