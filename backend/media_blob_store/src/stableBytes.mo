import Region "mo:core/Region";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Map "mo:core/Map";
import Blob "mo:core/Blob";
module {
  public type Slice = { offset : Nat64; length : Nat; slot : Nat };
  public type Store = { region : Region.Region; var end : Nat64; free : Map.Map<Nat, Map.Map<Nat64, ()>> };
  // Keep the existing operational budget until measured capacity tests pass.
  public let limit : Nat = 2_147_483_648;
  public let largeLimit : Nat = 68_719_476_736;
  // Explicit Region ceiling below the configured limit; leave runtime space.
  // This reserve is conservative policy, not a measured usable-space guarantee.
  public let physicalLimit : Nat = 68_652_367_872; // 64 GiB minus 64 MiB
  public func limitFor(large : Bool) : Nat { if (large) largeLimit else limit };
  public let responseChunk : Nat = 1_000_000;
  public func validSlice(end : Nat, slice : Slice) : Bool {
    slice.slot >= 65_536 and slice.slot <= 16_777_216 and slotFor(slice.slot) == slice.slot and
    slice.length <= slice.slot and slice.offset.toNat() % 65_536 == 0 and slice.offset.toNat() + slice.slot <= end
  };
  public func slotFor(length : Nat) : Nat {
    var slot = 65_536;
    while (slot < length) { slot *= 2 };
    slot
  };
  public func write(store : Store, bytes : Blob) : ?Slice { writeWithin(store, bytes, limit) };
  // At most nine size classes. Split only free slots; live offsets never move.
  func availableClass(store : Store, slot : Nat, cap : Nat) : ?(Nat, Nat64) {
    if (slot > 16_777_216) return null;
    var size = slot;
    while (size <= 16_777_216) {
      switch (store.free.get(size)) {
        case (?rows) {
          // Ordered map: if the lowest offset is outside the cap all later
          // offsets in this class are too; still try larger classes.
          switch (rows.entries().next()) {
            case (?(offset, _)) {
              if (offset.toNat() + size <= cap and validSlice(store.end.toNat(), { offset; length = slot; slot = size })) return ?(size, offset)
            };
            case null {}
          }
        };
        case null {}
      };
      size *= 2
    };
    null
  };
  func addFree(store : Store, slot : Nat, offset : Nat64) {
    let rows = switch (store.free.get(slot)) { case (?rows) rows; case null { let rows = Map.empty<Nat64, ()>(); store.free.add(slot, rows); rows } };
    rows.add(offset, ())
  };
  public func writeWithin(store : Store, bytes : Blob, cap : Nat) : ?Slice {
    let ?slice = reserveWithin(store, bytes.size(), cap) else return null;
    if (not writeReserved(store, slice, bytes)) { release(store, slice); return null };
    ?slice
  };
  // A reservation owns a real extent. No ciphertext is written until finalize;
  // concurrent admissions cannot all promise the same free buddy or tail.
  public func reserveWithin(store : Store, length : Nat, cap : Nat) : ?Slice {
    let boundedCap = Nat.min(cap, physicalLimit);
    let slot = slotFor(length);
    if (slot > 16_777_216) return null;
    switch (reserveFreeWithin(store, length, boundedCap)) { case (?slice) return ?slice; case null {} };
    let aligned = ((store.end.toNat() + slot - 1) / slot) * slot;
    if (aligned + slot > boundedCap) return null;
    let requiredPages = (aligned + slot + 65_535) / 65_536;
    let pages = Region.size(store.region).toNat();
    if (requiredPages > pages and Region.grow(store.region, Nat64.fromNat(requiredPages - pages)) == 18_446_744_073_709_551_615) return null;
    var padding = store.end.toNat();
    while (padding < aligned) {
      var size = 65_536;
      while (size * 2 <= aligned - padding and padding % (size * 2) == 0) { size *= 2 };
      addFree(store, size, Nat64.fromNat(padding)); padding += size
    };
    store.end := Nat64.fromNat(aligned + slot);
    ?{ offset = Nat64.fromNat(aligned); length; slot }
  };
  // Club arenas must never fall back to the shared tail. This primitive
  // consumes only already-owned free extents, even when their list is empty.
  public func reserveFreeWithin(store : Store, length : Nat, cap : Nat) : ?Slice {
    let slot = slotFor(length);
    if (slot > 16_777_216) return null;
    let offset = switch (availableClass(store, slot, Nat.min(cap, physicalLimit))) {
      case (?(size, offset)) {
        let ?offsets = store.free.get(size) else return null;
        offsets.remove(offset);
        var split = size;
        while (split > slot) {
          split /= 2;
          addFree(store, split, offset + Nat64.fromNat(split))
        };
        offset
      };
      case null return null
    };
    ?{ offset; length; slot }
  };
  // Caller must own the durable reservation; this never allocates or moves it.
  public func writeReserved(store : Store, slice : Slice, bytes : Blob) : Bool {
    if (bytes.size() != slice.length or not validSlice(store.end.toNat(), slice) or
      slice.offset.toNat() + slice.slot > Region.size(store.region).toNat() * 65_536) return false;
    Region.storeBlob(store.region, slice.offset, bytes); true
  };
  public func release(store : Store, slice : Slice) {
    if (not validSlice(store.end.toNat(), slice)) return;
    var slot = slice.slot;
    var offset = slice.offset.toNat();
    // Merge only aligned free buddies, never live or merely adjacent objects.
    while (slot < 16_777_216) {
      // Legacy allocations were only page-aligned, not size-class-aligned.
      // Never turn a legacy unaligned extent into a larger overlapping slot.
      if (offset % slot != 0) { addFree(store, slot, Nat64.fromNat(offset)); return };
      let buddy = if ((offset / slot) % 2 == 0) offset + slot else offset - slot;
      let ?rows = store.free.get(slot) else { addFree(store, slot, Nat64.fromNat(offset)); return };
      if (not rows.containsKey(Nat64.fromNat(buddy))) { addFree(store, slot, Nat64.fromNat(offset)); return };
      rows.remove(Nat64.fromNat(buddy));
      offset := Nat.min(offset, buddy); slot *= 2
    };
    addFree(store, slot, Nat64.fromNat(offset))
  };
  public func read(store : Store, slice : Slice, offset : Nat, requested : Nat) : Blob {
    if (not validSlice(store.end.toNat(), slice) or slice.offset.toNat() + slice.slot > Region.size(store.region).toNat() * 65_536 or offset >= slice.length) return "";
    Region.loadBlob(store.region, slice.offset + Nat64.fromNat(offset), Nat.min(requested, slice.length - offset))
  };
  public func canAllocate(store : Store, length : Nat) : Bool { canAllocateWithin(store, length, limit) };
  public func canReuseWithin(store : Store, length : Nat, configured : Nat) : Bool {
    let slot = slotFor(length);
    slot <= 16_777_216 and availableClass(store, slot, Nat.min(configured, physicalLimit)) != null
  };
  // Bounded proof of reusable *whole* maximum-size roots. Smaller holes
  // deliberately count as zero, even if their aggregate byte sum is large.
  public func allocatableRoots(store : Store, configured : Nat) : Nat {
    let cap = Nat.min(configured, physicalLimit);
    if (store.end.toNat() > cap) return 0;
    let root = 16_777_216;
    let freeRoots = switch (store.free.get(root)) { case (?rows) rows.size(); case null 0 };
    let aligned = ((store.end.toNat() + root - 1) / root) * root;
    freeRoots + (if (aligned > cap) 0 else (cap - aligned) / root)
  };
  public func canAllocateWithin(store : Store, length : Nat, configured : Nat) : Bool {
    let cap = Nat.min(configured, physicalLimit);
    let slot = slotFor(length);
    if (slot > 16_777_216) return false;
    if (availableClass(store, slot, cap) != null) return true;
    ((store.end.toNat() + slot - 1) / slot) * slot + slot <= cap
  }
}