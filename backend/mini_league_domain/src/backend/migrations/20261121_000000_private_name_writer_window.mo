import Map "mo:core/Map";
module {
  type Request = { operation_id : Text; generation : Nat64; inventory_digest : Blob };
  type Intent = { request : Request; closing : Bool; sealed : Bool; active : Nat };
  public func migration(_ : {}) : { var private_name_writer_intents : Map.Map<Text, Intent> } {
    { var private_name_writer_intents = Map.empty<Text, Intent>() }
  }
}
