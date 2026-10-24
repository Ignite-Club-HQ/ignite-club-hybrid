import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var deletionHashes : Map.Map<Text, Text> } {
    { var deletionHashes = Map.empty<Text, Text>() }
  }
}