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
  public let largeLimit : Nat = 34_359_738_368;
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
  func availableClass(store : Store, slot : Nat) : ?Nat {
    if (slot > 16_777_216) return null;
    var size = slot;
    while (size <= 16_777_216) {
      switch (store.free.get(size)) { case (?rows) { if (rows.size() > 0) return ?size }; case null {} };
      size *= 2
    };
    null
  };
  func addFree(store : Store, slot : Nat, offset : Nat64) {
    let rows = switch (store.free.get(slot)) { case (?rows) rows; case null { let rows = Map.empty<Nat64, ()>(); store.free.add(slot, rows); rows } };
    rows.add(offset, ())
  };
  public func writeWithin(store : Store, bytes : Blob, cap : Nat) : ?Slice {
    let length = bytes.size();
    let slot = slotFor(length);
    if (slot > 16_777_216) return null;
    let offset = switch (availableClass(store, slot)) {
      case (?size) {
        let ?offsets = store.free.get(size) else return null;
        let ?(offset, _) = offsets.entries().next() else return null;
        if (not validSlice(store.end.toNat(), { offset; length; slot = size })) return null;
        offsets.remove(offset);
        var split = size;
        while (split > slot) {
          split /= 2;
          addFree(store, split, offset + Nat64.fromNat(split))
        };
        offset
      };
      case null {
        let aligned = ((store.end.toNat() + slot - 1) / slot) * slot;
        if (aligned + slot > cap) return null;
        let requiredPages = (aligned + slot + 65_535) / 65_536;
        let pages = Region.size(store.region).toNat();
        if (requiredPages > pages and Region.grow(store.region, Nat64.fromNat(requiredPages - pages)) == 18_446_744_073_709_551_615) return null;
        // Preserve alignment for buddy merges; padding remains reusable.
        var padding = store.end.toNat();
        while (padding < aligned) {
          var size = 65_536;
          while (size * 2 <= aligned - padding and padding % (size * 2) == 0) { size *= 2 };
          addFree(store, size, Nat64.fromNat(padding)); padding += size
        };
        store.end := Nat64.fromNat(aligned + slot);
        Nat64.fromNat(aligned)
      }
    };
    Region.storeBlob(store.region, offset, bytes);
    ?{ offset; length; slot }
  };
  public func release(store : Store, slice : Slice) {
    if (not validSlice(store.end.toNat(), slice)) return;
    var slot = slice.slot;
    var offset = slice.offset.toNat();
    // Merge only aligned free buddies, never live or merely adjacent objects.
    while (slot < 16_777_216) {
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
  public func canAllocateWithin(store : Store, length : Nat, cap : Nat) : Bool {
    let slot = slotFor(length);
    if (slot > 16_777_216) return false;
    if (availableClass(store, slot) != null) return true;
    ((store.end.toNat() + slot - 1) / slot) * slot + slot <= cap
  }
}