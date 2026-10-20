import Map "mo:core/Map";
import Array "mo:core/Array";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Token "../../shared/MediaJournalToken";
import Retained "mediaRetainedQuota";
import Monthly "mediaQuota";
module {
  public type State = { acknowledged : Map.Map<Text, Bool> };
  public func empty() : State { { acknowledged = Map.empty() } };
  func key(store : Principal, token : Text) : Text { store.toText() # "\u{1f}" # token };
  public func acknowledge(state : State, retained : Retained.Ledger, monthly : Monthly.Ledger, store : Principal, token : Text) : Bool {
    if (Token.epoch(token) == null) return false;
    let id = key(store, token);
    let ?op = retained.operations.get(id) else return false;
    if (op.state == #reserved) return false;
    switch (Monthly.status(monthly, store, token)) {
      case (?row) {
        if (row.status == #reserved or (row.status == #committed) != (op.state == #committed)) return false
      };
      case null {} // branding and deletion have no monthly reservation
    };
    state.acknowledged.add(id, true); true
  };
  public func retire(state : State, retained : Retained.Ledger, monthly : Monthly.Ledger, current : Nat, cursor : Text) : { removed : Nat; cursor : Text } {
    var scanned = 0;
    var next = "";
    var deletes : [Text] = [];
    for ((id, op) in retained.operations.entriesFrom(cursor)) {
      if (id == cursor and cursor != "") continue;
      if (scanned >= 200) break;
      scanned += 1; next := id;
      if (op.state != #reserved and state.acknowledged.get(id) == ?true and Token.expired(op.token, current)) {
        // Recheck paired settlement at retirement, not just acknowledgement.
        let paired = switch (Monthly.status(monthly, op.store, op.token)) {
          case (?row) row.status != #reserved and (row.status == #committed) == (op.state == #committed);
          case null true
        };
        if (paired) deletes := deletes.concat([id])
      }
    };
    for (id in deletes.values()) {
      retained.operations.remove(id); monthly.reservations.remove(id); state.acknowledged.remove(id)
    };
    { removed = deletes.size(); cursor = if (scanned < 200) "" else next }
  };
}