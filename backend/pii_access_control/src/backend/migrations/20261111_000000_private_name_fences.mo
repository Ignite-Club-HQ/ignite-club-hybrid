import Map "mo:core/Map";
module {
  // Frozen inline protocol types; do not import mutable shared contracts.
  type Request = { operation_id : Text; generation : Nat64; inventory_digest : Blob };
  type Intent = { request : Request; completed : Bool };
  public func migration(_ : {}) : {
    var private_name_release_intents : Map.Map<Text, Intent>;
    var private_name_release_epoch : Nat;
  } {
    { var private_name_release_intents = Map.empty<Text, Intent>(); var private_name_release_epoch = 0 }
  }
}