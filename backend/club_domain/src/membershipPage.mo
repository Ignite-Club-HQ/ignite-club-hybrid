import Array "mo:core/Array";
import Nat "mo:core/Nat";
module {
  public type Page<T> = { rows : [T]; next : ?Nat; scanned : Nat };
  // Index-offset traversal is bounded per call, not an indexed membership map.
  public func read<T>(items : [T], offset : Nat, limit : Nat, visible : T -> Bool) : Page<T> {
    let cap = Nat.min(limit, 100);
    var index = offset;
    var scanned = 0;
    var rows : [T] = [];
    while (index < items.size() and scanned < 200 and rows.size() < cap) {
      let item = items[index];
      if (visible(item)) rows := rows.concat([item]);
      index += 1; scanned += 1;
    };
    { rows; scanned; next = if (index < items.size()) ?index else null }
  };
}