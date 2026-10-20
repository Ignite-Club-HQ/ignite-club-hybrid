import Map "mo:core/Map";
module {
  public func migration(_ : {}) : {
    var upload_slots : Map.Map<Text, { offset : Nat64; length : Nat; slot : Nat }>;
  } { { var upload_slots = Map.empty() } }
}