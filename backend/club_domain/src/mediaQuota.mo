import Map "mo:core/Map";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Nat "mo:core/Nat";
import Array "mo:core/Array";

module {
  public type Usage = { count : Nat; bytes : Nat; pending_count : Nat; pending_bytes : Nat };
  public type Reservation = {
    store : Principal; token : Text; club_id : Text; category : Text;
    cycle : Nat; bytes : Nat; status : { #reserved; #committed; #released };
  };
  public type Ledger = {
    usage : Map.Map<Text, Usage>;
    reservations : Map.Map<Text, Reservation>;
  };
  public type Result = { #Ok : Reservation; #Err : Text };
  public let cycleNs : Nat = 2_592_000_000_000_000;
  public let maxEntries : Nat = 100_000;
  public func authorizedPreparation(governor : Principal, caller : Principal, store : Principal, stores : [Principal]) : Bool {
    if (caller.equal(Principal.anonymous()) or not caller.equal(governor)) return false;
    for (registered in stores.values()) { if (registered.equal(store)) return true };
    false
  };
  public func empty() : Ledger { { usage = Map.empty(); reservations = Map.empty() } };
  func usageKey(club : Text, category : Text, cycle : Nat) : Text {
    club # "\u{1f}" # category # "\u{1f}" # debug_show(cycle)
  };
  func reservationKey(store : Principal, token : Text) : Text { Principal.toText(store) # "\u{1f}" # token };
  public func validId(id : Text) : Bool { id.size() > 0 and id.size() <= 128 and not Text.contains(id, #char '\u{1f}') };
  public func validCategory(category : Text) : Bool {
    category == "gallery_photo" or category == "chat_photo" or category == "chat_file" or category == "vault"
  };
  func usage(ledger : Ledger, key : Text) : Usage {
    switch (Map.get(ledger.usage, Text.compare, key)) {
      case (?row) row;
      case null { { count = 0; bytes = 0; pending_count = 0; pending_bytes = 0 } };
    }
  };
  public func getUsage(ledger : Ledger, club : Text, category : Text, cycle : Nat) : Usage { usage(ledger, usageKey(club, category, cycle)) };
  public func importUsage(ledger : Ledger, club : Text, category : Text, cycle : Nat, count : Nat, bytes : Nat) {
    let key = usageKey(club, category, cycle);
    let row = usage(ledger, key);
    ledger.usage.add(key, { row with count = row.count + count; bytes = row.bytes + bytes });
  };
  // Aborting an unknown request must create a tombstone: a delayed reserve
  // may still arrive. It must see #released rather than allocate capacity.
  public func cancel(ledger : Ledger, store : Principal, token : Text, club : Text, category : Text, bytes : Nat, cycle : Nat) : Result {
    switch (status(ledger, store, token)) {
      case (?saved) {
        if (saved.club_id != club or saved.category != category or saved.bytes != bytes or saved.cycle != cycle) return #Err("Token conflict");
        settle(ledger, store, token, false)
      };
      case null {
        if (not validId(token) or not validId(club) or not validCategory(category) or bytes > 10_551_296) return #Err("Invalid reservation");
        if (ledger.reservations.size() >= maxEntries) return #Err("Quota ledger full");
        let saved : Reservation = { store; token; club_id = club; category; bytes; cycle; status = #released };
        ledger.reservations.add(reservationKey(store, token), saved);
        #Ok(saved)
      };
    }
  };
  // Retire only old terminal records. Live APIs reject NEW old-cycle tokens;
  // unresolved reservations are never expired or refunded automatically.
  public func retirePage(ledger : Ledger, cycle : Nat, reservationCursor : Text, usageCursor : Text) : { removed : Nat; reservation_cursor : Text; usage_cursor : Text } {
    retireCoordinatedPage(ledger, cycle, reservationCursor, usageCursor, true)
  };
  public func retireCoordinatedPage(ledger : Ledger, cycle : Nat, reservationCursor : Text, usageCursor : Text, retireReservations : Bool) : { removed : Nat; reservation_cursor : Text; usage_cursor : Text } {
    var removed = 0;
    var scanned = 0;
    var nextReservation = "";
    var reservationDeletes : [Text] = [];
    for ((key, row) in ledger.reservations.entriesFrom(reservationCursor)) {
      if (key == reservationCursor and reservationCursor != "") continue;
      if (scanned >= 200) break;
      scanned += 1; nextReservation := key;
      if (retireReservations and row.cycle + 1 < cycle and row.status != #reserved) { reservationDeletes := reservationDeletes.concat([key]); removed += 1 };
    };
    for (key in reservationDeletes.values()) ledger.reservations.remove(key);
    if (scanned < 200) nextReservation := "";
    var usageRemoved = 0;
    scanned := 0;
    var nextUsage = "";
    var usageDeletes : [Text] = [];
    for ((key, row) in ledger.usage.entriesFrom(usageCursor)) {
      if (key == usageCursor and usageCursor != "") continue;
      if (scanned >= 200) break;
      scanned += 1; nextUsage := key;
      // The suffix is the cycle in debug_show format. Bound scans by ledger cap;
      // delete only zero-pending rows with an old terminal reservation-free key.
      if (usageRemoved < 200 and row.pending_count == 0) {
        let parts = Text.split(key, #char '\u{1f}');
        ignore parts.next(); ignore parts.next();
        switch (parts.next()) { case (?value) { switch (Nat.fromText(value)) { case (?old) { if (old + 1 < cycle) { usageDeletes := usageDeletes.concat([key]); usageRemoved += 1 } }; case null {} } }; case null {} };
      };
    };
    for (key in usageDeletes.values()) ledger.usage.remove(key);
    if (scanned < 200) nextUsage := "";
    { removed = removed + usageRemoved; reservation_cursor = nextReservation; usage_cursor = nextUsage }
  };
  public func status(ledger : Ledger, store : Principal, token : Text) : ?Reservation { Map.get(ledger.reservations, Text.compare, reservationKey(store, token)) };
  public func reserve(ledger : Ledger, store : Principal, token : Text, club : Text, category : Text, bytes : Nat, cycle : Nat, pro : Bool) : Result {
    if (not validId(token) or not validId(club) or not validCategory(category) or bytes > 10_551_296) return #Err("Invalid reservation");
    let key = reservationKey(store, token);
    switch (Map.get(ledger.reservations, Text.compare, key)) {
      case (?saved) {
        if (saved.club_id != club or saved.category != category or saved.bytes != bytes or saved.cycle != cycle) return #Err("Token conflict");
        return #Ok(saved);
      };
      case null {};
    };
    if (Map.size(ledger.reservations) >= maxEntries or Map.size(ledger.usage) >= maxEntries) return #Err("Quota ledger full");
    let uKey = usageKey(club, category, cycle);
    let row = usage(ledger, uKey);
    if (row.pending_count >= 64) return #Err("Too many pending club uploads");
    if (not pro) {
      if (row.count + row.pending_count + 1 > 10) return #Err("FreeLimitReached:" # category);
      if ((category == "vault" or category == "chat_file") and row.bytes + row.pending_bytes + bytes > 26_214_400) return #Err("FreeLimitReached:" # category);
    };
    let saved : Reservation = { store; token; club_id = club; category; cycle; bytes; status = #reserved };
    Map.add(ledger.usage, Text.compare, uKey, { row with pending_count = row.pending_count + 1; pending_bytes = row.pending_bytes + bytes });
    Map.add(ledger.reservations, Text.compare, key, saved);
    #Ok(saved)
  };
  public func settle(ledger : Ledger, store : Principal, token : Text, commit : Bool) : Result {
    let key = reservationKey(store, token);
    let saved = switch (Map.get(ledger.reservations, Text.compare, key)) { case (?r) r; case null return #Err("Unknown reservation") };
    if (saved.status == #committed) { if (commit) return #Ok(saved) else return #Err("Already committed") };
    if (saved.status == #released) { if (not commit) return #Ok(saved) else return #Err("Already released") };
    let uKey = usageKey(saved.club_id, saved.category, saved.cycle);
    let row = usage(ledger, uKey);
    // Fail closed before any mutation if persistent accounting is inconsistent.
    if (row.pending_count == 0 or row.pending_bytes < saved.bytes) return #Err("Reservation accounting mismatch");
    let updated : Usage = {
      count = row.count + (if (commit) 1 else 0);
      bytes = row.bytes + (if (commit) saved.bytes else 0);
      pending_count = row.pending_count - 1;
      pending_bytes = row.pending_bytes - saved.bytes;
    };
    let result = { saved with status = if (commit) #committed else #released };
    Map.add(ledger.usage, Text.compare, uKey, updated);
    Map.add(ledger.reservations, Text.compare, key, result);
    #Ok(result)
  };
}