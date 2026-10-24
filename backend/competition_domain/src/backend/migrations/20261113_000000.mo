import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var broadcastDeliveries : Map.Map<Text, { sender : Principal; competition : Text; divisions : [Text]; title : Text; body : Text; broadcast_id : Text; completed : [(Text, Nat16)]; unknown : ?Text }> } {
    { var broadcastDeliveries = Map.empty() }
  }
}