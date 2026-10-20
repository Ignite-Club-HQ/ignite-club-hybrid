import Stable "stableBytes";
import Region "mo:core/Region";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Blob "mo:core/Blob";
module {
  // Global addresses retain the old Slice shape. Bank zero is the original
  // Region: no existing offsets, records, free lists or reservations move.
  public type Store = { legacy : Stable.Store; regions : Map.Map<Nat, Stable.Store> };
  public let bankBytes : Nat = 68_719_476_736; // 64 GiB, root-aligned
  public let targetBytes : Nat = 536_870_912_000; // 500 GiB design address space
  public let maxBanks : Nat = 8;
  // Motoko 1.16.1 shares a 256 GiB Region block table across ALL Regions.
  // Multi-Region storage cannot remove that limit. Keep real growth below
  // 200 GiB, with space for runtime metadata/block rounding and stable state.
  public let runtimeBytes : Nat = 214_748_364_800;
  public let runtimeReserve : Nat = 67_108_864;
  public let blockBytes : Nat = 8_388_608;
  public func address(offset : Nat64, slot : Nat) : ?(Nat, Nat64) {
    let at = offset.toNat();
    let bank = at / bankBytes;
    let local = at % bankBytes;
    if (slot == 0 or slot > 16_777_216 or bank >= maxBanks or
      local + slot > bankBytes or at + slot > targetBytes) return null;
    ?(bank, local.toNat64())
  };
  public func bankCapacity(bank : Nat, configured : Nat) : Nat {
    let cap = Nat.min(configured, targetBytes);
    let start = bank * bankBytes;
    if (bank >= maxBanks or start >= cap) return 0;
    // Keep the original bank's tested guard and old pointer semantics.
    Nat.min(Stable.physicalLimit, Nat.min(bankBytes, cap - start))
  };
  func selected(store : Store, bank : Nat) : ?Stable.Store {
    if (bank == 0) ?store.legacy else store.regions.get(bank)
  };
  func rounded(store : Stable.Store) : Nat {
    let bytes = Region.size(store.region).toNat() * 65_536;
    ((bytes + blockBytes - 1) / blockBytes) * blockBytes
  };
  public func allocated(store : Store) : Nat64 {
    var bytes = store.legacy.end.toNat();
    for ((_, bank) in store.regions.entries()) bytes += bank.end.toNat();
    bytes.toNat64()
  };
  public func physicalBytes(store : Store) : Nat {
    var bytes = rounded(store.legacy);
    for ((_, bank) in store.regions.entries()) bytes += rounded(bank);
    bytes
  };
  func growthFits(store : Store, bank : ?Stable.Store, length : Nat, cap : Nat) : Bool {
    let slot = Stable.slotFor(length);
    if (slot > 16_777_216) return false;
    let end = switch (bank) { case (?b) b.end.toNat(); case null 0 };
    let aligned = ((end + slot - 1) / slot) * slot;
    // Free-slot allocation consumes no new physical pages. The allocator
    // will attempt that first; conservatively allow only when tail growth
    // also fits, except a bank already at its local ceiling.
    let wanted = ((aligned + slot + blockBytes - 1) / blockBytes) * blockBytes;
    let current = switch (bank) { case (?b) rounded(b); case null 0 };
    if (aligned + slot > cap) return false;
    physicalBytes(store) + (if (wanted > current) wanted - current else 0) <= runtimeBytes - runtimeReserve
  };
  public func canAllocateWithin(store : Store, length : Nat, configured : Nat, enabled : Bool) : Bool {
    if (not enabled) return Stable.canAllocateWithin(store.legacy, length, configured);
    if (configured > runtimeBytes) return false;
    for (bank in Nat.range(0, maxBanks)) {
      let cap = bankCapacity(bank, configured);
      let b = selected(store, bank);
      switch (b) {
        case (?b) {
          if (Stable.canReuseWithin(b, length, cap)) return true;
          if (Stable.canAllocateWithin(b, length, cap) and growthFits(store, ?b, length, cap)) return true
        };
        case null { if (growthFits(store, null, length, cap)) return true }
      }
    };
    false
  };
  func globalSlice(bank : Nat, slice : Stable.Slice) : Stable.Slice {
    { slice with offset = (bank * bankBytes + slice.offset.toNat()).toNat64() }
  };
  public func reserveWithin(store : Store, length : Nat, configured : Nat, enabled : Bool) : ?Stable.Slice {
    if (not enabled) return Stable.reserveWithin(store.legacy, length, configured);
    if (configured > runtimeBytes) return null;
    for (bank in Nat.range(0, maxBanks)) {
      let cap = bankCapacity(bank, configured);
      let b = selected(store, bank);
      switch (b) {
        case (?b) {
          switch (Stable.reserveFreeWithin(b, length, cap)) { case (?s) return ?globalSlice(bank, s); case null {} };
          if (growthFits(store, ?b, length, cap)) {
            switch (Stable.reserveWithin(b, length, cap)) { case (?s) return ?globalSlice(bank, s); case null {} }
          }
        };
        case null {
          if (growthFits(store, null, length, cap)) {
            let fresh : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
            switch (Stable.reserveWithin(fresh, length, cap)) {
              case (?s) { store.regions.add(bank, fresh); return ?globalSlice(bank, s) };
              case null {}
            }
          }
        }
      }
    };
    null
  };
  func localSlice(store : Store, slice : Stable.Slice) : ?(Stable.Store, Stable.Slice) {
    let ?(bank, offset) = address(slice.offset, slice.slot) else return null;
    let ?b = selected(store, bank) else return null;
    let local = { slice with offset };
    if (not Stable.validSlice(b.end.toNat(), local)) return null;
    ?(b, local)
  };
  public func writeReserved(store : Store, slice : Stable.Slice, bytes : Blob) : Bool {
    let ?(b, local) = localSlice(store, slice) else return false;
    Stable.writeReserved(b, local, bytes)
  };
  public func release(store : Store, slice : Stable.Slice) {
    let ?(b, local) = localSlice(store, slice) else return;
    Stable.release(b, local)
  };
  public func read(store : Store, slice : Stable.Slice, offset : Nat, requested : Nat) : Blob {
    let ?(b, local) = localSlice(store, slice) else return "";
    Stable.read(b, local, offset, requested)
  };
  public func writeWithin(store : Store, bytes : Blob, configured : Nat, enabled : Bool) : ?Stable.Slice {
    let ?slice = reserveWithin(store, bytes.size(), configured, enabled) else return null;
    if (not writeReserved(store, slice, bytes)) { release(store, slice); return null };
    ?slice
  };
  public func allocatableRoots(store : Store, configured : Nat, enabled : Bool) : Nat {
    if (not enabled) return Stable.allocatableRoots(store.legacy, configured);
    // Root telemetry is not a physical-growth guarantee for a multi-bank
    // store until an authority has budgeted the shared runtime ceiling.
    0
  }
}