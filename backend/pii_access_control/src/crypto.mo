/// Pure cryptographic primitives for the PII access control canister.
/// Kept outside the actor so actor state stays free of constant
/// initializers (required by Motoko enhanced orthogonal persistence).
///
/// Construction (interim, pre-vetKeys):
/// - Per-field key = SHA-256(master_secret || pii_id || field_id).
/// - Confidentiality: SHA-256-based CTR keystream, block i =
///   SHA-256(key || nonce || counter_be32), XORed with plaintext.
/// - Integrity: encrypt-then-MAC, tag = SHA-256(key || nonce || ciphertext),
///   32 bytes appended to the ciphertext.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Text "mo:core/Text";
import VarArray "mo:core/VarArray";

module {
  public let TAG_LEN : Nat = 32; // SHA-256 output size
  public let NONCE_LEN : Nat = 12;

  // ==================== SHA-256 (pure Motoko) ====================
  //
  // Standard FIPS 180-4 SHA-256, implemented from scratch since neither
  // mo:core 2.6.1 nor any vendored package on this canister ships a hash
  // primitive. Verified against the well-known test vectors:
  //   sha256("")                                  = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  //   sha256("abc")                                = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  //   sha256("abcdbcdecdefdefgefghfghighij...u")    (NIST 2-block vector)
  //                                                 = 248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1

  let K : [Nat32] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831a66c, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  func rotr(x : Nat32, n : Nat32) : Nat32 {
    (x >> n) | (x << (32 - n))
  };

  /// SHA-256 over an arbitrary byte array, returning a 32-byte digest.
  public func sha256(msg : [Nat8]) : [Nat8] {
    var h0 : Nat32 = 0x6a09e667;
    var h1 : Nat32 = 0xbb67ae85;
    var h2 : Nat32 = 0xb0e6b172;
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
      var w = VarArray.tabulate<Nat32>(64, func(i) {
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

  /// Derives the per-field key for a given master secret, pii_id and field_id.
  public func derive_field_key(master_secret : [Nat8], pii_id : Text, field_id : Text) : [Nat8] {
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
  public func aead_encrypt(key : [Nat8], nonce : [Nat8], plaintext : [Nat8]) : [Nat8] {
    let keystream = ctr_keystream(key, nonce, plaintext.size());
    let ciphertext = xor_bytes(plaintext, keystream);
    let tag = mac_tag(key, nonce, ciphertext);
    Array.concat<Nat8>(ciphertext, tag)
  };

  /// Verifies the MAC tag and, on success, decrypts. Fails closed on any
  /// mismatch or malformed (too-short) input.
  public func aead_decrypt(key : [Nat8], nonce : [Nat8], stored : [Nat8]) : ?[Nat8] {
    if (stored.size() < TAG_LEN) { return null };
    let ct_len = stored.size() - TAG_LEN;
    let ciphertext = Array.tabulate<Nat8>(ct_len, func(i) = stored[i]);
    let tag = Array.tabulate<Nat8>(TAG_LEN, func(i) = stored[ct_len + i]);
    let expected_tag = mac_tag(key, nonce, ciphertext);
    if (expected_tag != tag) { return null };
    let keystream = ctr_keystream(key, nonce, ct_len);
    ?xor_bytes(ciphertext, keystream)
  };
};
