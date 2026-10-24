import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var competitionBroadcastReceipts : Map.Map<Text, { club : Text; related : Text; body : Text; count : Nat16 }> } {
    { var competitionBroadcastReceipts = Map.empty() }
  }
}