import Nat "mo:core/Nat";
import Array "mo:core/Array";
module {
  // Cursor advances even when all sampled clubs are Pro or lookup fails.
  public func indices(size : Nat, cursor : Nat, limit : Nat) : [Nat] {
    if (size == 0) return [];
    let count = Nat.min(size, limit);
    var out : [Nat] = [];
    var i = 0;
    while (i < count) { out := out.concat([(cursor + i) % size]); i += 1 };
    out
  }
}