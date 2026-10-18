import Nat64 "mo:core/Nat64";

// Heap-backed legacy store: deliberately conservative until stable-backed
// streaming is deployed. These are admission budgets, not ICP platform limits.
module {
  public let capacityCeiling : Nat64 = 2_147_483_648;
  public let heapBudget : Nat = 3_221_225_472;
  public let maxWireBytes : Nat64 = 10_551_296; // 10 MiB plaintext + encryption framing
  public let maxChunkBytes : Nat = 1_000_000;
  public let maxChunkCount : Nat = 11;
  public let maxPending : Nat = 64;
  public let maxPendingPerOwner : Nat = 4;

  public func effectiveCapacity(configured : Nat64) : Nat64 {
    if (configured > capacityCeiling) capacityCeiling else configured
  };

  public func threshold(configured : Nat64) : Nat {
    effectiveCapacity(configured).toNat() * 8 / 10
  };

  public func validDeclaration(size : Nat64, chunks : Nat) : Bool {
    size <= maxWireBytes and chunks > 0 and chunks <= maxChunkCount and
    (if (size == 0) chunks == 1 else chunks <= size.toNat() and size.toNat() <= chunks * maxChunkBytes)
  };

  // No overwrite credit: both old ciphertext and new chunks coexist until
  // finalization. Include all reservations, including uploads awaiting chunks.
  public func canAdmit(configured : Nat64, finalized : Nat64, reserved : Nat, requested : Nat64, heap : Nat) : Bool {
    let pending = reserved + requested.toNat();
    finalized.toNat() + pending <= threshold(configured) and
    heap + pending * 16 <= heapBudget
  };

  public func canWriteChunk(declared : Nat64, stored : Nat, replaced : Nat, incoming : Nat, heap : Nat) : Bool {
    if (replaced > stored) return false;
    incoming <= maxChunkBytes and
    stored - replaced + incoming <= declared.toNat() and
    heap + incoming * 16 <= heapBudget
  };
}