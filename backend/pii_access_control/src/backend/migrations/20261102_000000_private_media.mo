import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var privateMediaAuthorities : Map.Map<Text, { competition : ?Principal; revision : Nat; move_id : Text }> } {
    { var privateMediaAuthorities = Map.empty<Text, { competition : ?Principal; revision : Nat; move_id : Text }>() }
  }
}