import Map "mo:core/Map";
module {
  // Additive, frozen inline state. No ciphertext/key or ownership changes.
  public func migration(_ : {}) : {
    var media_inventory_revision : Nat;
    var media_transfer_fences : Map.Map<Text, Nat>;
  } {
    { var media_inventory_revision = 0; var media_transfer_fences = Map.empty<Text, Nat>() }
  }
}