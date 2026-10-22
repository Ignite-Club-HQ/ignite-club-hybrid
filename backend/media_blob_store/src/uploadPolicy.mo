import Nat64 "mo:core/Nat64";

// Heap-backed legacy store: deliberately conservative until stable-backed
// streaming is deployed. These are admission budgets, not ICP platform limits.
module {
  public let capacityCeiling : Nat64 = 2_147_483_648;
  // Opt-in ceiling for stable-backed stores (IGNITE_MEDIA_LARGE_CAPACITY=1).
  // Configured maximum; 80% admission and allocator/runtime headroom still apply.
  public let largeCapacityCeiling : Nat64 = 214_748_364_800; // 200 GiB (build page cap 240 GiB, runtime table 256 GiB)
  // Finalized + pending file records per store.
  public let maxStoredFiles : Nat = 1_000_000;
  // Pro media allowance: 3 GiB per club across vault, gallery and chat combined,
  // plus purchased add-on GB.
  public let proMediaBaseBytes : Nat = 3_221_225_472;
  public let freeMediaBaseBytes : Nat = 262_144_000;
  public let teamMediaBaseBytes : Nat = 1_073_741_824;
  public func withinMediaAllowance(used : Nat, pending : Nat, requested : Nat, limit : Nat) : Bool { used + pending + requested <= limit };
  let gib : Nat = 1_073_741_824;
  public let heapBudget : Nat = 3_221_225_472;
  public let maxWireBytes : Nat64 = 10_551_296; // 10 MiB plaintext + encryption framing
  public let maxChunkBytes : Nat = 1_000_000;
  public let maxChunkCount : Nat = 11;
  public let maxPending : Nat = 64;
  public let maxPendingPerOwner : Nat = 4;

  public func ceilingFor(large : Bool) : Nat64 { if (large) largeCapacityCeiling else capacityCeiling };

  public func effectiveCapacityFor(configured : Nat64, large : Bool) : Nat64 {
    let ceiling = ceilingFor(large);
    if (configured > ceiling) ceiling else configured
  };

  public func effectiveCapacity(configured : Nat64) : Nat64 { effectiveCapacityFor(configured, false) };

  public func thresholdFor(configured : Nat64, large : Bool) : Nat {
    effectiveCapacityFor(configured, large).toNat() * 8 / 10
  };

  public func threshold(configured : Nat64) : Nat { thresholdFor(configured, false) };

  /// Pro allowance: finalized + in-flight media bytes for the club (vault,
  /// gallery and chat combined) plus this upload must fit within 3 GiB + purchased GB.
  public func withinProMediaAllowance(used : Nat, pending : Nat, requested : Nat, purchasedGb : Nat) : Bool {
    used + pending + requested <= proMediaBaseBytes + purchasedGb * gib
  };

  public func validDeclaration(size : Nat64, chunks : Nat) : Bool {
    size <= maxWireBytes and chunks > 0 and chunks <= maxChunkCount and
    (if (size == 0) chunks == 1 else chunks <= size.toNat() and size.toNat() <= chunks * maxChunkBytes)
  };

  // No overwrite credit: both old ciphertext and new chunks coexist until
  // finalization. Include all reservations, including uploads awaiting chunks.
  public func canAdmit(configured : Nat64, finalized : Nat64, reserved : Nat, requested : Nat64, heap : Nat) : Bool {
    canAdmitFor(configured, finalized, reserved, requested, heap, false)
  };

  public func canAdmitFor(configured : Nat64, finalized : Nat64, reserved : Nat, requested : Nat64, heap : Nat, large : Bool) : Bool {
    canAdmitWithCeiling(configured, finalized, reserved, requested, heap, ceilingFor(large))
  };
  public func canAdmitWithCeiling(configured : Nat64, finalized : Nat64, reserved : Nat, requested : Nat64, heap : Nat, ceiling : Nat64) : Bool {
    let pending = reserved + requested.toNat();
    let effective = if (configured > ceiling) ceiling else configured;
    finalized.toNat() + pending <= effective.toNat() * 8 / 10 and
    heap + pending * 16 <= heapBudget
  };

  public func canWriteChunk(declared : Nat64, stored : Nat, replaced : Nat, incoming : Nat, heap : Nat) : Bool {
    if (replaced > stored) return false;
    incoming <= maxChunkBytes and
    stored - replaced + incoming <= declared.toNat() and
    heap + incoming * 16 <= heapBudget
  };

  public func withinFreeQuota(count : Nat, bytes : Nat, pendingCount : Nat, pendingBytes : Nat, requested : Nat, countLimit : Nat, bytesLimit : ?Nat64) : Bool {
    count + pendingCount + 1 <= countLimit and
    (switch (bytesLimit) { case (?limit) bytes + pendingBytes + requested <= limit.toNat(); case null true })
  };
}