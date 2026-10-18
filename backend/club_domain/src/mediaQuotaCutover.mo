import Map "mo:core/Map";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Nat64 "mo:core/Nat64";
import Array "mo:core/Array";
import Quota "mediaQuota";

module {
  public type Row = { club_id : Text; category : Text; cycle : Nat; count : Nat; bytes : Nat64 };
  public type Page = { frozen : Bool; pending : Nat; total : Nat; offset : Nat; rows : [Row] };
  public type Progress = { offset : Nat; total : ?Nat; done : Bool };
  public type State = { var active : Bool; var started : Bool; imports : Map.Map<Text, Progress>; imported_rows : Map.Map<Text, ()>; ledger : Quota.Ledger };
  public func empty() : State { { var active = false; var started = false; imports = Map.empty(); imported_rows = Map.empty(); ledger = Quota.empty() } };
  func rowKey(store : Principal, row : Row) : Text { store.toText() # "\u{1f}" # row.club_id # "\u{1f}" # row.category # "\u{1f}" # debug_show(row.cycle) };
  public func progress(state : State, store : Principal) : Progress {
    state.imports.get(store.toText()) ?? ({ offset = 0; total = null; done = false })
  };
  public func ready(state : State, store : Principal, stores : [Principal]) : Bool {
    state.active and stores.any(func(p) = p.equal(store)) and progress(state, store).done
  };
  // Pages come directly from a frozen registered canister, never the browser.
  // Validate the entire page before changing either accounting or the cursor.
  public func applyPage(state : State, store : Principal, page : Page) : { #Ok; #Err : Text } {
    if (not state.started or not page.frozen or page.pending != 0) return #Err("Store must be frozen and drained");
    let saved = progress(state, store);
    if (saved.done) return #Ok;
    if (page.offset != saved.offset) return #Err("Import cursor changed; retry");
    if (page.total > Quota.maxEntries or page.rows.size() > 200 or page.offset + page.rows.size() > page.total) return #Err("Invalid snapshot bounds");
    switch (saved.total) { case (?total) { if (total != page.total) return #Err("Snapshot changed") }; case null {} };
    if (page.rows.size() == 0 and page.offset != page.total) return #Err("Incomplete snapshot");
    if (state.ledger.usage.size() + page.rows.size() > Quota.maxEntries) return #Err("Quota ledger full");
    if (state.imported_rows.size() + page.rows.size() > Quota.maxEntries) return #Err("Snapshot row index full");
    let seen = Map.empty<Text, ()>();
    for (row in page.rows.values()) {
      if (not Quota.validId(row.club_id) or not Quota.validCategory(row.category)) return #Err("Invalid snapshot row");
      let key = rowKey(store, row);
      if (seen.containsKey(key) or state.imported_rows.containsKey(key)) return #Err("Duplicate snapshot row");
      seen.add(key, ());
    };
    for (row in page.rows.values()) {
      Quota.importUsage(state.ledger, row.club_id, row.category, row.cycle, row.count, row.bytes.toNat());
      state.imported_rows.add(rowKey(store, row), ())
    };
    let offset = page.offset + page.rows.size();
    state.imports.add(store.toText(), { offset; total = ?page.total; done = offset == page.total });
    #Ok
  };
  public func activate(state : State, stores : [Principal]) : { #Ok; #Err : Text } {
    if (not state.started or stores.size() == 0 or not stores.all(func(p) = progress(state, p).done)) return #Err("Every registered store must be imported");
    state.active := true;
    #Ok
  };
}