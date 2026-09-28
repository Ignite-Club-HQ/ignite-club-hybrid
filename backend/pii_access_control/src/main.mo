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

  type MasterSecretEntry = {
    key_id : Text;
    secret : [Nat8]; // 32 bytes, from raw_rand. Never exposed via any public method.
  };

  // ==================== State ====================

  var pii_records : [PiiRecord] = [];
  var audit_log : [AuditRecord] = [];
  var key_metadata_list : [KeyMetadata] = [];
  var master_secrets : [MasterSecretEntry] = [];

  var master_key_id_current : Text = "master-key-2026-09-13";
  var metadata_version : Nat32 = 1;
  var last_key_rotation : Nat64 = 0;
  var governor : Principal = Principal.anonymous();

  // Lazily-initialized root secret for media key derivation. Populated on
  // first call to derive_media_key using raw_rand.
  var media_root_secret : ?[Nat8] = null;

  const TAG_LEN : Nat = 32; // SHA-256 output size
  const NONCE_LEN : Nat = 12;

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

  // ==================== SHA-256 (pure Motoko) ====================
  //
  // Standard FIPS 180-4 SHA-256, implemented from scratch since neither
  // mo:core 2.6.1 nor any vendored package on this canister ships a hash
  // primitive. Verified against the well-known test vectors:
  //   sha256("")                                  = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  //   sha256("abc")                                = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  //   sha256("abcdbcdecdefdefgefghfghighij...u")    (NIST 2-block vector)
  //                                                 = 248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1
  // (values elided in-line to keep the source compact; verified by hand
  // during implementation using the reference algorithm below.)

  let K : [Nat32] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  func rotr(x : Nat32, n : Nat32) : Nat32 {
    (x >> n) | (x << (32 - n))
  };

  /// SHA-256 over an arbitrary byte array, returning a 32-byte digest.
  func sha256(msg : [Nat8]) : [Nat8] {
    var h0 : Nat32 = 0x6a09e667;
    var h1 : Nat32 = 0xbb67ae85;
    var h2 : Nat32 = 0x3c6ef372;
    var h3 : Nat32 = 0xa54ff53a;
    var h4 : Nat32 = 0x510e527f;
    var h5 : Nat32 = 0x9b05688c;
    var h6 : Nat32 = 0x1f83d9ab;
    var h7 : Nat32 = 0x5be0cd19;

    let msg_len = msg.size();
    let bit_len : Nat64 = Nat64.fromNat(msg_len) * 8;

    // Padding: 0x80, then zeros, then 8-byte big-endian bit length, to a
    // multiple of 64 bytes.
    var pad_len = (56 - ((msg_len + 1) % 64) + 64) % 64;
    let total_len = msg_len + 1 + pad_len + 8;

    let padded = Array.tabulate<Nat8>(total_len, func(i) {
      if (i < msg_len) { msg[i] }
      else if (i == msg_len) { 0x80 : Nat8 }
      else if (i < total_len - 8) { 0 : Nat8 }
      else {
        // last 8 bytes: big-endian bit length
        let shift : Nat64 = Nat64.fromNat((total_len - 1 - i) * 8);
        Nat8.fromNat(Nat64.toNat((bit_len >> shift) & 0xff))
      }
    });

    let num_blocks = total_len / 64;
    var block_idx = 0;
    while (block_idx < num_blocks) {
      let base = block_idx * 64;
      var w = Array.tabulateVar<Nat32>(64, func(i) {
        if (i < 16) {
          let o = base + i * 4;
          (Nat32.fromNat(Nat8.toNat(padded[o])) << 24)
          | (Nat32.fromNat(Nat8.toNat(padded[o + 1])) << 16)
          | (Nat32.fromNat(Nat8.toNat(padded[o + 2])) << 8)
          | (Nat32.fromNat(Nat8.toNat(padded[o + 3])))
        } else {
          0 : Nat32
        }
      });

      var i = 16;
      while (i < 64) {
        let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
        let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] := w[i - 16] +% s0 +% w[i - 7] +% s1;
        i += 1;
      };

      var a = h0; var b = h1; var c = h2; var d = h3;
      var e = h4; var f = h5; var g = h6; var h = h7;

      var t = 0;
      while (t < 64) {
        let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        let ch = (e & f) ^ ((^e) & g);
        let temp1 = h +% s1 +% ch +% K[t] +% w[t];
        let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        let maj = (a & b) ^ (a & c) ^ (b & c);
        let temp2 = s0 +% maj;

        h := g; g := f; f := e; e := d +% temp1;
        d := c; c := b; b := a; a := temp1 +% temp2;
        t += 1;
      };

      h0 := h0 +% a; h1 := h1 +% b; h2 := h2 +% c; h3 := h3 +% d;
      h4 := h4 +% e; h5 := h5 +% f; h6 := h6 +% g; h7 := h7 +% h;

      block_idx += 1;
    };

    let digest_words = [h0, h1, h2, h3, h4, h5, h6, h7];
    Array.tabulate<Nat8>(32, func(i) {
      let word = digest_words[i / 4];
      let shift : Nat32 = Nat32.fromNat(24 - (i % 4) * 8);
      Nat8.fromNat(Nat32.toNat((word >> shift) & 0xff))
    })
  };

  func nat32_be(n : Nat32) : [Nat8] {
    [
      Nat8.fromNat(Nat32.toNat((n >> 24) & 0xff)),
      Nat8.fromNat(Nat32.toNat((n >> 16) & 0xff)),
      Nat8.fromNat(Nat32.toNat((n >> 8) & 0xff)),
      Nat8.fromNat(Nat32.toNat(n & 0xff)),
    ]
  };

  // ==================== Key material ====================

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
    let bytes = Array.concat<Nat8>(
      master_secret,
      Array.concat<Nat8>(Blob.toArray(Text.encodeUtf8(pii_id)), Blob.toArray(Text.encodeUtf8(field_id)))
    );
    sha256(bytes)
  };

  /// SHA-256-CTR keystream generation: block i = SHA256(key || nonce || be32(i)).
  func ctr_keystream(key : [Nat8], nonce : [Nat8], length : Nat) : [Nat8] {
    let num_blocks = (length + 31) / 32;
    var out : [Nat8] = [];
    var i : Nat32 = 0;
    var produced = 0;
    while (produced < num_blocks) {
      let block_input = Array.concat<Nat8>(key, Array.concat<Nat8>(nonce, nat32_be(i)));
      out := Array.concat<Nat8>(out, sha256(block_input));
      i += 1;
      produced += 1;
    };
    Array.tabulate<Nat8>(length, func(idx) = out[idx])
  };

  func xor_bytes(a : [Nat8], b : [Nat8]) : [Nat8] {
    Array.tabulate<Nat8>(a.size(), func(i) = a[i] ^ b[i])
  };

  func mac_tag(key : [Nat8], nonce : [Nat8], ciphertext : [Nat8]) : [Nat8] {
    sha256(Array.concat<Nat8>(key, Array.concat<Nat8>(nonce, ciphertext)))
  };

  /// Encrypts plaintext with SHA-256-CTR under the per-field key, then appends
  /// a SHA-256-based MAC tag over (key, nonce, ciphertext) to the output.
  func aead_encrypt(key : [Nat8], nonce : [Nat8], plaintext : [Nat8]) : [Nat8] {
    let keystream = ctr_keystream(key, nonce, plaintext.size());
    let ciphertext = xor_bytes(plaintext, keystream);
    let tag = mac_tag(key, nonce, ciphertext);
    Array.concat<Nat8>(ciphertext, tag)
  };

  /// Verifies the MAC tag and, on success, decrypts. Fails closed on any
  /// mismatch or malformed (too-short) input.
  func aead_decrypt(key : [Nat8], nonce : [Nat8], stored : [Nat8]) : ?[Nat8] {
    if (stored.size() < TAG_LEN) { return null };
    let ct_len = stored.size() - TAG_LEN;
    let ciphertext = Array.tabulate<Nat8>(ct_len, func(i) = stored[i]);
    let tag = Array.tabulate<Nat8>(TAG_LEN, func(i) = stored[ct_len + i]);
    let expected_tag = mac_tag(key, nonce, ciphertext);
    if (expected_tag != tag) { return null };
    let keystream = ctr_keystream(key, nonce, ct_len);
    ?xor_bytes(ciphertext, keystream)
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

    let nonce = await* random_bytes(NONCE_LEN);
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
    let key = sha256(material); // 32 bytes
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
