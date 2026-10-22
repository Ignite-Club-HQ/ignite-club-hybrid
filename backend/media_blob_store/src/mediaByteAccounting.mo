import Blob "mo:core/Blob";
module {
  // @icp-sdk/vetkeys IbeCiphertext framing: 8-byte version header,
  // 96-byte compressed G2 point and 32-byte seed. No decryption/key material.
  public let framingBytes : Nat = 136;
  public let maxPlaintextBytes : Nat = 10_485_760;
  public func pendingBytes(wire : Nat) : Nat { if (wire >= framingBytes) wire - framingBytes else wire };
  public func framed(prefix : Blob, wire : Nat) : Bool {
    if (wire < framingBytes or prefix.size() < 8) return false;
    let p = prefix.toArray();
    p[0] == 73 and p[1] == 67 and p[2] == 32 and p[3] == 73 and p[4] == 66 and p[5] == 69 and p[6] == 0 and p[7] == 1
  };
  public func storedBytes(prefix : Blob, wire : Nat) : Nat { if (framed(prefix, wire)) pendingBytes(wire) else wire };
  public func validFile(bytes : Blob) : Bool { framed(bytes, bytes.size()) and pendingBytes(bytes.size()) <= maxPlaintextBytes };
};