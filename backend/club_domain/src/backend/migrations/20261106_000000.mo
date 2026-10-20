import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var mediaJournalState : { acknowledged : Map.Map<Text, Bool> } } {
    { var mediaJournalState = { acknowledged = Map.empty() } }
  }
}