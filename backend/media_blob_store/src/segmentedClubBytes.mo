import Packed "packedClubBytes";
import Space "clubPhysicalSpace";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Region "mo:core/Region";
import Blob "mo:core/Blob";
import Array "mo:core/Array";
import Text "mo:core/Text";
module {
  // Local prototype bound, not a new customer upload/allowance rule.
  public let maxSegments : Nat = 512;
  public let recordBytes : Nat = 48;
  public type Handle = { generation : Nat64; length : Nat; segments : Nat; table : Packed.Handle };
  public type State = { pool : Packed.State; files : Map.Map<Nat64, Handle> };
  public func empty(pool : Packed.State) : State { { pool; files = Map.empty() } };
  func valid(state : State, file : Handle) : Bool {
    if (state.files.get(file.generation) != ?file) return false;
    Packed.contains(state.pool, file.table)
  };
  func position(file : Handle, index : Nat) : Nat64 { file.table.page + (file.table.offset + index * recordBytes).toNat64() };
  func save(state : State, file : Handle, index : Nat, segment : Packed.Handle) {
    let region = state.pool.space.store.region;
    let at = position(file, index);
    Region.storeNat64(region, at, segment.generation.toNat64());
    Region.storeNat64(region, at + 8, segment.page);
    Region.storeNat64(region, at + 16, segment.offset.toNat64());
    Region.storeNat64(region, at + 24, segment.length.toNat64());
    Region.storeNat64(region, at + 32, segment.slot.toNat64());
    Region.storeNat64(region, at + 40, 0)
  };
  func load(state : State, file : Handle, index : Nat) : Packed.Handle {
    let region = state.pool.space.store.region;
    let at = position(file, index);
    { generation = Region.loadNat64(region, at).toNat(); page = Region.loadNat64(region, at + 8);
      offset = Region.loadNat64(region, at + 16).toNat(); length = Region.loadNat64(region, at + 24).toNat();
      slot = Region.loadNat64(region, at + 32).toNat() }
  };
  public func reserve(state : State, length : Nat) : ?Handle {
    if (length == 0 or length > maxSegments * Packed.pageBytes) return null;
    let count = (length + Packed.pageBytes - 1) / Packed.pageBytes;
    // Nat64 descriptor encoding must never wrap generations.
    if (state.pool.space.nextGeneration + count * 2 + 2 >= 18_446_744_073_709_551_615) return null;
    let ?table = Packed.reserve(state.pool, count * recordBytes) else return null;
    if (not Packed.write(state.pool, table, Array.repeat<Nat8>(0, count * recordBytes).toBlob())) {
      Packed.release(state.pool, table); return null
    };
    state.pool.space.nextGeneration += 1;
    let file : Handle = { generation = state.pool.space.nextGeneration.toNat64(); length; segments = count; table };
    var acquired = 0;
    while (acquired < count) {
      let amount = Nat.min(Packed.pageBytes, length - acquired * Packed.pageBytes);
      switch (Packed.reserve(state.pool, amount)) {
        case (?segment) { save(state, file, acquired, segment); acquired += 1 };
        case null {
          var i = 0;
          while (i < acquired) { Packed.release(state.pool, load(state, file, i)); i += 1 };
          Packed.release(state.pool, table);
          return null
        }
      }
    };
    state.files.add(file.generation, file); ?file
  };
  // Exactly one bounded page per call; never assemble whole ciphertexts.
  public func writeSegment(state : State, file : Handle, index : Nat, bytes : Blob) : Bool {
    if (not valid(state, file) or index >= file.segments) return false;
    let segment = load(state, file, index);
    if (not Packed.write(state.pool, segment, bytes)) return false;
    Region.storeNat64(state.pool.space.store.region, position(file, index) + 40, 1); true
  };
  public func complete(state : State, file : Handle) : Bool {
    if (not valid(state, file)) return false;
    var i = 0;
    while (i < file.segments) {
      if (Region.loadNat64(state.pool.space.store.region, position(file, i) + 40) != 1) return false;
      i += 1
    }; true
  };
  public func read(state : State, file : Handle, offset : Nat, requested : Nat) : Blob {
    if (not valid(state, file) or offset >= file.length or requested > Packed.pageBytes) return "";
    let amount = Nat.min(requested, file.length - offset);
    var cursor = offset;
    var remaining = amount;
    var chunks : [[Nat8]] = [];
    while (remaining > 0) {
      let index = cursor / Packed.pageBytes;
      if (Region.loadNat64(state.pool.space.store.region, position(file, index) + 40) != 1) return "";
      let segment = load(state, file, index);
      let inner = cursor % Packed.pageBytes;
      let take = Nat.min(remaining, segment.length - inner);
      let bytes = Packed.read(state.pool, segment, inner, take);
      if (bytes.size() != take) return "";
      chunks := chunks.concat([bytes.toArray()]); cursor += take; remaining -= take
    };
    var a = 0; var b = 0;
    Array.tabulate<Nat8>(amount, func _ {
      while (b >= chunks[a].size()) { a += 1; b := 0 };
      let value = chunks[a][b]; b += 1; value
    }).toBlob()
  };
  public func release(state : State, file : Handle) {
    if (not valid(state, file)) return;
    var i = 0;
    while (i < file.segments) { Packed.release(state.pool, load(state, file, i)); i += 1 };
    state.files.remove(file.generation);
    Packed.release(state.pool, file.table)
  };
}