import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var defaultClubChats : Map.Map<Text, Text> } {
    { var defaultClubChats = Map.empty<Text, Text>() }
  };
}