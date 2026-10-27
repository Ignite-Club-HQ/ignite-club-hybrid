import Map "mo:core/Map";
module {
  type Receipt = { id : Text; club : Text; subject : Principal; original_retained : Bool; replica_absent : Bool };
  public func migration(_ : {}) : { var private_name_cleanup_receipts : Map.Map<Text, { caller : Principal; receipt : Receipt }> } {
    { var private_name_cleanup_receipts = Map.empty<Text, { caller : Principal; receipt : Receipt }>() }
  }
}