import Stable "stableBytes";
import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Blob "mo:core/Blob";
import Array "mo:core/Array";
module {
  public let rootBytes : Nat = 16_777_216;
  public type Allocation = { generation : Nat; slice : Stable.Slice };
  public type Arena = { store : Stable.Store; var promised : Nat; var roots : Nat; held : Map.Map<Nat64, Allocation> };
  public type State = { store : Stable.Store; arenas : Map.Map<Text, Arena>; var nextGeneration : Nat };
  public func empty(store : Stable.Store) : State { { store; arenas = Map.empty(); var nextGeneration = 0 } };
  // The caller must authenticate and bind this ledger to its exact store.
  // Physical roots are removed from the shared allocator synchronously.
  // No promises or roots are released on downgrade, deletion or retries.
  public func promise(state : State, club : Text, bytes : Nat, cap : Nat) : Bool {
    let sharedStore = state.store;
    if (club.size() == 0 or club.size() > 128 or bytes == 0 or bytes > cap) return false;
    let old = state.arenas.get(club);
    let oldBytes = switch (old) { case (?arena) arena.promised; case null 0 };
    if (oldBytes >= bytes) return true;
    let oldRoots = switch (old) { case (?arena) arena.roots; case null 0 };
    let wanted = (bytes + rootBytes - 1) / rootBytes;
    if (wanted > cap / rootBytes or wanted < oldRoots) return false;
    // This proof counts whole reusable roots, not scattered free bytes.
    if (Stable.allocatableRoots(sharedStore, cap) < wanted - oldRoots) return false;
    var held : [Stable.Slice] = [];
    var n = oldRoots;
    while (n < wanted) {
      switch (Stable.reserveWithin(sharedStore, rootBytes, cap)) {
        case (?slice) held := held.concat([slice]);
        case null {
          for (slice in held.values()) Stable.release(sharedStore, slice);
          return false
        }
      };
      n += 1
    };
    let arena = switch (old) {
      case (?arena) arena;
      case null { { store = { region = sharedStore.region; var end = sharedStore.end; free = Map.empty<Nat, Map.Map<Nat64, ()>>() }; var promised = 0; var roots = 0; held = Map.empty<Nat64, Allocation>() } }
    };
    // Only owned extents are free inside this arena; there is no private tail.
    arena.store.end := sharedStore.end;
    let rows = arena.store.free.get(rootBytes) ?? Map.empty<Nat64, ()>();
    for (slice in held.values()) rows.add(slice.offset, ());
    arena.store.free.add(rootBytes, rows);
    arena.promised := bytes; arena.roots := wanted; state.arenas.add(club, arena); true
  };
  public func reserve(state : State, club : Text, length : Nat) : ?Allocation {
    let ?arena = state.arenas.get(club) else return null;
    // A private arena cannot extend into another club's root or global tail.
    let ?slice = Stable.reserveFreeWithin(arena.store, length, arena.store.end.toNat()) else return null;
    state.nextGeneration += 1;
    let allocation = { generation = state.nextGeneration; slice };
    arena.held.add(slice.offset, allocation); ?allocation
  };
  public func release(state : State, club : Text, allocation : Allocation) {
    let ?arena = state.arenas.get(club) else return;
    let slice = allocation.slice;
    if (arena.held.get(slice.offset) != ?allocation) return;
    arena.held.remove(slice.offset);
    Stable.release(arena.store, slice)
  };
  public func write(state : State, club : Text, allocation : Allocation, bytes : Blob) : Bool {
    let ?arena = state.arenas.get(club) else return false;
    let slice = allocation.slice;
    if (arena.held.get(slice.offset) != ?allocation) return false;
    Stable.writeReserved(arena.store, slice, bytes)
  };
}