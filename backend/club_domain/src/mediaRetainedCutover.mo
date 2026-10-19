import Map "mo:core/Map";
import Array "mo:core/Array";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Quota "mediaRetainedQuota";
module {
  public type Cursor = { phase : { #legacy; #indexed; #done }; offset : Nat; after : Text };
  public type Row = { path : Text; club : ?Text; bytes : Nat; content_hash : Text; revision : Nat };
  public type Page = { frozen : Bool; pending : Nat; authority : ?Principal; revision : Nat; total : Nat; total_bytes : Nat; cursor : Cursor; next : Cursor; rows : [Row] };
  public type Progress = { cursor : Cursor; revision : ?Nat; total : ?Nat; total_bytes : ?Nat; count : Nat; bytes : Nat; done : Bool };
  public type State = { var started : Bool; var active : Bool; var stores : [Principal]; imports : Map.Map<Text, Progress>; seen : Map.Map<Text, ()>; ledger : Quota.Ledger };
  public let first : Cursor = { phase = #legacy; offset = 0; after = "" };
  public func empty() : State { { var started = false; var active = false; var stores = []; imports = Map.empty(); seen = Map.empty(); ledger = Quota.empty() } };
  public func progress(s : State, store : Principal) : Progress { s.imports.get(store.toText()) ?? ({ cursor = first; revision = null; total = null; total_bytes = null; count = 0; bytes = 0; done = false }) };
  public func start(s : State, stores : [Principal]) : Bool {
    if (s.started) return s.stores == stores;
    if (stores.size() == 0 or stores.size() > 64) return false;
    let seen = Map.empty<Text, ()>();
    for (p in stores.values()) { if (p.isAnonymous() or p.toText() == "aaaaa-aa" or seen.containsKey(p.toText())) return false; seen.add(p.toText(), ()) };
    for (p in stores.values()) { if (not Quota.register(s.ledger, p)) return false };
    s.stores := stores; s.started := true; true
  };
  public func apply(s : State, authority : Principal, store : Principal, page : Page) : { #Ok; #Err : Text } {
    if (not s.started or s.active or not s.stores.any(func(p) = p == store)) return #Err("Sealed store required");
    let saved = progress(s, store);
    if (saved.done) return #Ok;
    if (not page.frozen or page.pending != 0 or page.authority != ?authority) return #Err("Store must be frozen, drained and bound to authority");
    if (page.cursor != saved.cursor or page.rows.size() > 200 or page.total > Quota.maxEntries or saved.count + page.rows.size() > page.total) return #Err("Invalid snapshot cursor or bounds");
    if ((saved.revision != null and saved.revision != ?page.revision) or (saved.total != null and saved.total != ?page.total) or (saved.total_bytes != null and saved.total_bytes != ?page.total_bytes)) return #Err("Snapshot changed");
    switch (page.cursor.phase, page.next.phase) {
      case (#legacy, #legacy) { if (page.next.offset != page.cursor.offset + page.rows.size() or page.next.offset <= page.cursor.offset or page.next.after != "") return #Err("Invalid legacy continuation") };
      case (#legacy, #indexed) { if (page.next.offset != 0 or page.next.after != "") return #Err("Invalid phase transition") };
      case (#indexed, #indexed) { if (page.rows.size() == 0 or page.next.after <= page.cursor.after or page.next.offset != 0) return #Err("Invalid indexed continuation") };
      case (#indexed, #done) { if (page.next.offset != 0 or page.next.after != "") return #Err("Invalid terminal cursor") };
      case _ return #Err("Invalid snapshot phase")
    };
    if (s.seen.size() + page.rows.size() > Quota.maxEntries or s.ledger.objects.size() + page.rows.size() > Quota.maxEntries) return #Err("Snapshot ledger full");
    let seen = Map.empty<Text, ()>(); var bytes = saved.bytes;
    for (row in page.rows.values()) {
      let key = store.toText() # "\u{1f}" # row.path;
      if (row.path == "" or row.path.size() > 512 or row.path.contains(#char '\u{1f}') or row.content_hash.size() != 64 or seen.containsKey(key) or s.seen.containsKey(key)) return #Err("Invalid or duplicate snapshot object");
      switch (row.club) { case (?club) { if (club == "" or club.size() > 128 or club.contains(#char '/') or club.contains(#char '\u{1f}') or not row.path.startsWith(#text("clubs/" # club # "/"))) return #Err("Invalid club ownership") }; case null { if (row.path.startsWith(#text "clubs/")) return #Err("Unresolved club object") } };
      seen.add(key, ()); bytes += row.bytes
    };
    let count = saved.count + page.rows.size(); let done = page.next.phase == #done;
    if (bytes > page.total_bytes or (done and (count != page.total or bytes != page.total_bytes))) return #Err("Incomplete snapshot totals");
    for (row in page.rows.values()) {
      s.seen.add(store.toText() # "\u{1f}" # row.path, ());
      switch (row.club) { case (?club) { assert Quota.baseline(s.ledger, { store; path = row.path; club; bytes = row.bytes; revision = row.revision }) }; case null {} }
    };
    if (done) { assert Quota.seal(s.ledger, store) };
    s.imports.add(store.toText(), { cursor = page.next; revision = ?page.revision; total = ?page.total; total_bytes = ?page.total_bytes; count; bytes; done }); #Ok
  };
  public func complete(s : State) : Bool { s.started and s.stores.size() > 0 and s.stores.all(func(p) = progress(s, p).done) and Quota.ready(s.ledger) };
  public func ready(s : State, caller : Principal) : Bool { s.active and complete(s) and s.stores.any(func(p) = p == caller) };
}
