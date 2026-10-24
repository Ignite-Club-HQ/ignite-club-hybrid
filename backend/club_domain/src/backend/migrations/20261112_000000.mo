import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var vaultErasedClubs : Map.Map<Text, Bool>; var vaultErasedTeams : Map.Map<Text, Text> } {
    { var vaultErasedClubs = Map.empty<Text, Bool>(); var vaultErasedTeams = Map.empty<Text, Text>() }
  };
}