import Space "clubPhysicalSpace";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Region "mo:core/Region";
import Blob "mo:core/Blob";
import Text "mo:core/Text";
module {
  public let pageBytes : Nat = 65_536;
  public type Handle = { generation : Nat; page : Nat64; offset : Nat; length : Nat; slot : Nat };
  public type Page = { allocation : Space.Allocation; free : Map.Map<Nat, Map.Map<Nat, ()>>; live : Map.Map<Nat, Handle>; written : Map.Map<Nat, Nat> };
  public type State = { space : Space.State; club : Text; pages : Map.Map<Nat64, Page>; var nextGeneration : Nat };
  public func empty(space : Space.State, club : Text) : State {
    { space; club; pages = Map.empty(); var nextGeneration = 0 }
  };
  public func slotFor(length : Nat) : Nat {
    var size = 1;
    while (size < length) size *= 2;
    size
  };
  func addFree(page : Page, size : Nat, offset : Nat) {
    let rows = page.free.get(size) ?? Map.empty<Nat, ()>();
    rows.add(offset, ()); page.free.add(size, rows)
  };
  func takeFree(page : Page, slot : Nat) : ?Nat {
    var size = slot;
    while (size <= pageBytes) {
      switch (page.free.get(size)) {
        case (?rows) {
          switch (rows.entries().next()) {
            case (?(offset, _)) {
              rows.remove(offset);
              var split = size;
              while (split > slot) { split /= 2; addFree(page, split, offset + split) };
              return ?offset
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
  // Bounded by an owned root's page count, never by the number of tiny files.
  // Zero-byte ciphertext is not supported here: caller uses the legacy path
  // until its framing/metadata semantics have been separately reconciled.
  public func reserve(state : State, length : Nat) : ?Handle {
    if (length == 0 or length > pageBytes) return null;
    let slot = slotFor(length);
    var selected : ?(Nat64, Page, Nat) = null;
    for ((id, page) in state.pages.entries()) {
      switch (takeFree(page, slot)) {
        case (?offset) { selected := ?(id, page, offset); break };
        case null {}
      }
    };
    let (id, page, offset) = switch (selected) {
      case (?row) row;
      case null {
        let ?allocation = Space.reserve(state.space, state.club, pageBytes) else return null;
        let page : Page = { allocation; free = Map.empty(); live = Map.empty(); written = Map.empty() };
        addFree(page, pageBytes, 0);
        let ?offset = takeFree(page, slot) else { Space.release(state.space, state.club, allocation); return null };
        let id = allocation.slice.offset;
        state.pages.add(id, page);
        (id, page, offset)
      }
    };
    state.space.nextGeneration += 1;
    state.nextGeneration := state.space.nextGeneration;
    let handle = { generation = state.nextGeneration; page = id; offset; length; slot };
    page.live.add(offset, handle); ?handle
  };
  func owned(state : State, handle : Handle) : ?Page {
    let ?page = state.pages.get(handle.page) else return null;
    if (page.live.get(handle.offset) != ?handle) return null;
    let ?arena = state.space.arenas.get(state.club) else return null;
    if (arena.held.get(page.allocation.slice.offset) != ?page.allocation) return null;
    if (handle.offset + handle.slot > pageBytes or handle.length > handle.slot) return null;
    ?page
  };
  // Trusted internal modules may validate a descriptor before Region I/O.
  public func contains(state : State, handle : Handle) : Bool {
    let ?_page = owned(state, handle) else return false; true
  };
  public func write(state : State, handle : Handle, bytes : Blob) : Bool {
    if (bytes.size() != handle.length) return false;
    let ?page = owned(state, handle) else return false;
    Region.storeBlob(state.space.store.region, page.allocation.slice.offset + handle.offset.toNat64(), bytes);
    page.written.add(handle.offset, handle.generation);
    true
  };
  public func read(state : State, handle : Handle, offset : Nat, requested : Nat) : Blob {
    let ?page = owned(state, handle) else return "";
    if (page.written.get(handle.offset) != ?handle.generation) return "";
    if (offset >= handle.length) return "";
    Region.loadBlob(state.space.store.region, page.allocation.slice.offset + (handle.offset + offset).toNat64(), Nat.min(requested, handle.length - offset))
  };
  public func release(state : State, handle : Handle) {
    let ?page = owned(state, handle) else return;
    page.live.remove(handle.offset);
    page.written.remove(handle.offset);
    var size = handle.slot;
    var offset = handle.offset;
    while (size < pageBytes) {
      let buddy = if ((offset / size) % 2 == 0) offset + size else offset - size;
      let ?rows = page.free.get(size) else break;
      if (not rows.containsKey(buddy)) break;
      rows.remove(buddy); offset := Nat.min(offset, buddy); size *= 2
    };
    addFree(page, size, offset);
    if (page.live.size() == 0) {
      state.pages.remove(handle.page);
      Space.release(state.space, state.club, page.allocation)
    }
  };
}