import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Array "mo:core/Array";
import Iter "mo:core/Iter";
// Indexed membership: account -> ordered club set. Pages cost O(limit),
// independent of total profiles, replacing the bounded full-scan traversal.
module {
  public type Index = Map.Map<Text, Map.Map<Text, ()>>;
  public type Page = { clubs : [Text]; next : ?Text };
  public func empty() : Index = Map.empty<Text, Map.Map<Text, ()>>();
  public func add(ix : Index, account : Text, club : Text) {
    let set = switch (Map.get(ix, Text.compare, account)) {
      case (?s) s;
      case null { let s = Map.empty<Text, ()>(); Map.add(ix, Text.compare, account, s); s };
    };
    Map.add(set, Text.compare, club, ());
  };
  public func remove(ix : Index, account : Text, club : Text) {
    switch (Map.get(ix, Text.compare, account)) {
      case (?s) { Map.remove(s, Text.compare, club); if (Map.isEmpty(s)) Map.remove(ix, Text.compare, account) };
      case null {};
    };
  };
  public func has(ix : Index, account : Text, club : Text) : Bool =
    switch (Map.get(ix, Text.compare, account)) { case (?s) Map.containsKey(s, Text.compare, club); case null false };
  // Cursor = last club returned (exclusive). Limit capped at 100.
  public func page(ix : Index, account : Text, after : ?Text, limit : Nat) : Page {
    let cap = Nat.min(limit, 100);
    switch (Map.get(ix, Text.compare, account)) {
      case null ({ clubs = []; next = null });
      case (?s) {
        let iter = switch (after) { case (?a) Map.entriesFrom(s, Text.compare, a); case null Map.entries(s) };
        var out : [Text] = []; var more = false;
        label scan for ((club, _) in iter) {
          if (?club == after) continue scan;
          if (out.size() == cap) { more := true; break scan };
          out := out.concat([club]);
        };
        { clubs = out; next = if (more and out.size() > 0) ?out[out.size() - 1] else null }
      };
    };
  };
}
