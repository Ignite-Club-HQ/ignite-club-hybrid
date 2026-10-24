import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var competitionBroadcastAudiences : Map.Map<Text, [Text]> } {
    { var competitionBroadcastAudiences = Map.empty() }
  }
}