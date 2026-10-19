import Nat64 "mo:core/Nat64";

// Heap-backed legacy store: deliberately conservative until stable-backed
// streaming is deployed. These are admission budgets, not ICP platform limits.
module {
  public let capacityCeiling : Nat64 = 2_147_483_648;
  // Opt-in ceiling for stable-backed stores (IGNITE_MEDIA_LARGE_CAPACITY=1).
  // Off until a mainnet load test confirms cycles/latency at this size.
  public let largeCapacityCeiling : Nat64 = 34_359_738_368; // 32 GiB
  // Pro vault allowance: 5 GiB per club plus purchased add-on GB.
  public let proVaultBaseBytes : Nat = 5_368_709_120;
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

  /// Pro vault: finalized + in-flight vault bytes for the club plus this
  /// upload must fit within 5 GiB + purchased GB.
  public func withinProVault(used : Nat, pending : Nat, requested : Nat, purchasedGb : Nat) : Bool {
    used + pending + requested <= proVaultBaseBytes + purchasedGb * gib
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
    let pending = reserved + requested.toNat();
    finalized.toNat() + pending <= thresholdFor(configured, large) and
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