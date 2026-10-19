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
  public func writeWithin(store : Store, bytes : Blob, cap : Nat) : ?Slice {
    let length = bytes.size();
    let slot = slotFor(length);
    if (slot > 16_777_216) return null;
    let offsets = switch (store.free.get(slot)) { case (?map) map; case null { let map = Map.empty<Nat64, ()>(); store.free.add(slot, map); map } };
    let offset = switch (offsets.entries().next()) {
      case (?(offset, _)) {
        if (not validSlice(store.end.toNat(), { offset; length; slot })) return null;
        offsets.remove(offset); offset
      };
      case null {
        if (store.end.toNat() + slot > cap) return null;
        let requiredPages = (store.end.toNat() + slot + 65_535) / 65_536;
        let pages = Region.size(store.region).toNat();
        if (requiredPages > pages and Region.grow(store.region, Nat64.fromNat(requiredPages - pages)) == 18_446_744_073_709_551_615) return null;
        let offset = store.end;
        store.end += Nat64.fromNat(slot);
        offset
      }
    };
    Region.storeBlob(store.region, offset, bytes);
    ?{ offset; length; slot }
  };
  public func release(store : Store, slice : Slice) {
    if (not validSlice(store.end.toNat(), slice)) return;
    let offsets = switch (store.free.get(slice.slot)) { case (?map) map; case null { let map = Map.empty<Nat64, ()>(); store.free.add(slice.slot, map); map } };
    offsets.add(slice.offset, ())
  };
  public func read(store : Store, slice : Slice, offset : Nat, requested : Nat) : Blob {
    if (not validSlice(store.end.toNat(), slice) or slice.offset.toNat() + slice.slot > Region.size(store.region).toNat() * 65_536 or offset >= slice.length) return "";
    Region.loadBlob(store.region, slice.offset + Nat64.fromNat(offset), Nat.min(requested, slice.length - offset))
  };
  public func canAllocate(store : Store, length : Nat) : Bool { canAllocateWithin(store, length, limit) };
  public func canAllocateWithin(store : Store, length : Nat, cap : Nat) : Bool {
    let slot = slotFor(length);
    switch (store.free.get(slot)) { case (?offsets) { if (offsets.size() > 0) return true }; case null {} };
    store.end.toNat() + slot <= cap
  }
}