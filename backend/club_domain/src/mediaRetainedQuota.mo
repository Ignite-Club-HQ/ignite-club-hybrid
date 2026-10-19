import Map "mo:core/Map";
import Text "mo:core/Text";
import Principal "mo:core/Principal";

// Retained bytes are independent of monthly upload counts. This ledger is
// deliberately separate from mediaQuota and cannot activate production itself.
module {
  public let baseBytes : Nat = 5_368_709_120;
  public let gib : Nat = 1_073_741_824;
  public let maxEntries : Nat = 100_000;
  public type Object = { store : Principal; path : Text; club : Text; bytes : Nat; revision : Nat };
  public type Operation = {
    store : Principal; token : Text; path : Text; club : Text; bytes : Nat;
    previous : ?Object; state : { #reserved; #committed; #released };
  };
  public type Ledger = {
    objects : Map.Map<Text, Object>; operations : Map.Map<Text, Operation>;
    locks : Map.Map<Text, Text>; totals : Map.Map<Text, Nat>; pending : Map.Map<Text, Nat>;
    stores : Map.Map<Text, Bool>; revisions : Map.Map<Text, Nat>;
  };
  public type Result = { #Ok : Operation; #Err : Text };
  public func empty() : Ledger {
    { objects = Map.empty(); operations = Map.empty(); locks = Map.empty();
      totals = Map.empty(); pending = Map.empty(); stores = Map.empty(); revisions = Map.empty() }
  };
  func key(store : Principal, id : Text) : Text { store.toText() # "\u{1f}" # id };
  func valid(id : Text) : Bool { id.size() > 0 and id.size() <= 512 and not Text.contains(id, #char '\u{1f}') };
  func amount(rows : Map.Map<Text, Nat>, club : Text) : Nat { rows.get(club) ?? 0 };
  public func usage(ledger : Ledger, club : Text) : { finalized : Nat; pending : Nat } {
    { finalized = amount(ledger.totals, club); pending = amount(ledger.pending, club) }
  };
  public func register(ledger : Ledger, store : Principal) : Bool {
    if (store.isAnonymous() or store.toText() == "aaaaa-aa") return false;
    let id = store.toText();
    if (ledger.stores.get(id) != null) return true;
    if (ledger.stores.size() >= 64) return false;
    ledger.stores.add(id, false); true
  };
  // Only a frozen/drained, authenticated exact inventory may call baseline.
  // Conflicting repeat pages fail, instead of adding retained bytes twice.
  public func baseline(ledger : Ledger, entry : Object) : Bool {
    if (ledger.stores.get(entry.store.toText()) != ?false or not valid(entry.club) or not valid(entry.path)) return false;
    let id = key(entry.store, entry.path);
    switch (ledger.objects.get(id)) {
      case (?saved) return saved == entry;
      case null {};
    };
    if (ledger.objects.size() >= maxEntries) return false;
    ledger.objects.add(id, entry); ledger.revisions.add(id, entry.revision);
    ledger.totals.add(entry.club, amount(ledger.totals, entry.club) + entry.bytes); true
  };
  // Caller must prove end-of-inventory, hashes and no concurrent mutations.
  // No inferred readiness from an empty page or a frontend-configured store.
  public func seal(ledger : Ledger, store : Principal) : Bool {
    if (ledger.stores.get(store.toText()) == null) return false;
    ledger.stores.add(store.toText(), true); true
  };
  public func ready(ledger : Ledger) : Bool {
    if (ledger.stores.size() == 0) return false;
    for ((_, complete) in ledger.stores.entries()) { if (not complete) return false };
    true
  };
  public func reserve(ledger : Ledger, store : Principal, token : Text, club : Text, path : Text, bytes : Nat, pro : Bool, purchasedGb : Nat) : Result {
    if (not ready(ledger) or ledger.stores.get(store.toText()) != ?true) return #Err("Retained inventory incomplete");
    if (not valid(token) or not valid(club) or not valid(path) or bytes > 10_551_296) return #Err("Invalid reservation");
    let operationId = key(store, token);
    switch (ledger.operations.get(operationId)) {
      case (?saved) {
        if (saved.path != path or saved.club != club or saved.bytes != bytes) return #Err("Token conflict");
        return #Ok(saved)
      };
      case null {};
    };
    let objectId = key(store, path);
    if (ledger.locks.get(objectId) != null) return #Err("Object mutation pending");
    let previous = ledger.objects.get(objectId);
    switch (previous) { case (?saved) { if (saved.club != club) return #Err("Storage owner conflict") }; case null {} };
    if (ledger.operations.size() >= maxEntries or (previous == null and ledger.objects.size() + ledger.locks.size() >= maxEntries)) return #Err("Retained ledger full");
    let held = amount(ledger.pending, club);
    // Conservative reservation: old and new bytes coexist until commit. No
    // refund before the store has durably published the replacement.
    if (pro and amount(ledger.totals, club) + held + bytes > baseBytes + purchasedGb * gib) return #Err("StorageAllowanceFull");
    let op : Operation = { store; token; club; path; bytes; previous; state = #reserved };
    ledger.pending.add(club, held + bytes);
    ledger.operations.add(operationId, op); ledger.locks.add(objectId, operationId);
    #Ok(op)
  };
  public func settle(ledger : Ledger, store : Principal, token : Text, commit : Bool) : Result {
    let id = key(store, token);
    let op = ledger.operations.get(id) ?? (return #Err("Unknown reservation"));
    if (op.state == #committed) { if (commit) return #Ok(op) else return #Err("Already committed") };
    if (op.state == #released) { if (not commit) return #Ok(op) else return #Err("Already released") };
    let objectId = key(store, op.path);
    let held = amount(ledger.pending, op.club);
    let used = amount(ledger.totals, op.club);
    let oldBytes = switch (op.previous) { case (?previous) previous.bytes; case null 0 };
    if (held < op.bytes or used < oldBytes or ledger.locks.get(objectId) != ?id or ledger.objects.get(objectId) != op.previous) return #Err("Retained accounting mismatch");
    let updated = { op with state = if (commit) #committed else #released };
    if (commit) {
      let revision = (ledger.revisions.get(objectId) ?? 0) + 1;
      ledger.revisions.add(objectId, revision);
      ledger.objects.add(objectId, { store; path = op.path; club = op.club; bytes = op.bytes; revision });
      ledger.totals.add(op.club, used - oldBytes + op.bytes)
    };
    ledger.pending.add(op.club, held - op.bytes); ledger.locks.remove(objectId);
    ledger.operations.add(id, updated); #Ok(updated)
  };
  // A delayed reserve after an acknowledged abort must not resurrect capacity.
  public func cancel(ledger : Ledger, store : Principal, token : Text, club : Text, path : Text, bytes : Nat) : Result {
    let id = key(store, token);
    switch (ledger.operations.get(id)) {
      case (?saved) {
        if (saved.club != club or saved.path != path or saved.bytes != bytes) return #Err("Token conflict");
        settle(ledger, store, token, false)
      };
      case null {
        if (ledger.stores.get(store.toText()) == null or not valid(token) or not valid(club) or not valid(path) or bytes > 10_551_296 or ledger.operations.size() >= maxEntries) return #Err("Invalid cancellation");
        let saved : Operation = { store; token; club; path; bytes; previous = null; state = #released };
        ledger.operations.add(id, saved); #Ok(saved)
      };
    }
  };
  // Idempotent exact revision deletion credit. A late receipt must never
  // remove a newer replacement or refund its bytes. Journal is not retired.
  public func prepareDeleted(ledger : Ledger, store : Principal, token : Text, entry : Object) : Result {
    if (not ready(ledger) or ledger.stores.get(store.toText()) != ?true or entry.store != store or not valid(token)) return #Err("Invalid deletion");
    let id = key(store, token);
    switch (ledger.operations.get(id)) {
      case (?saved) {
        if (saved.path != entry.path or saved.club != entry.club or saved.previous != ?entry or saved.bytes != 0 or saved.state == #released) return #Err("Token conflict");
        return #Ok(saved)
      };
      case null {}
    };
    let objectId = key(store, entry.path);
    if (ledger.objects.get(objectId) != ?entry or ledger.locks.get(objectId) != null) return #Err("Deletion revision mismatch");
    if (ledger.operations.size() >= maxEntries) return #Err("Retained ledger full");
    let saved : Operation = { store; token; path = entry.path; club = entry.club; bytes = 0; previous = ?entry; state = #reserved };
    ledger.operations.add(id, saved); ledger.locks.add(objectId, id); #Ok(saved)
  };
  public func deleted(ledger : Ledger, store : Principal, token : Text, entry : Object) : Result {
    if (not ready(ledger) or ledger.stores.get(store.toText()) != ?true or entry.store != store or not valid(token)) return #Err("Invalid deletion");
    let id = key(store, token);
    switch (ledger.operations.get(id)) {
      case (?saved) {
        if (saved.path != entry.path or saved.club != entry.club or saved.previous != ?entry or saved.bytes != 0 or saved.state == #released) return #Err("Token conflict");
        if (saved.state == #committed) return #Ok(saved)
      };
      case null {};
    };
    let objectId = key(store, entry.path);
    let used = amount(ledger.totals, entry.club);
    let lock = ledger.locks.get(objectId);
    if (ledger.objects.get(objectId) != ?entry or (lock != null and lock != ?id) or used < entry.bytes) return #Err("Deletion revision mismatch");
    if (ledger.operations.get(id) == null and ledger.operations.size() >= maxEntries) return #Err("Retained ledger full");
    let saved : Operation = { store; token; path = entry.path; club = entry.club; bytes = 0; previous = ?entry; state = #committed };
    ledger.objects.remove(objectId); ledger.locks.remove(objectId); ledger.totals.add(entry.club, used - entry.bytes);
    ledger.operations.add(id, saved); #Ok(saved)
  };
}