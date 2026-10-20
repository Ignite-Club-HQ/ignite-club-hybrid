import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var mediaGrowthState : { var configured : Bool; var usable : Nat; var unassigned : Nat; var freeBytes : Nat; var revision : Nat; commitments : Map.Map<Text, Nat> } } {
    { var mediaGrowthState = { var configured = false; var usable = 0; var unassigned = 0; var freeBytes = 0; var revision = 0; commitments = Map.empty() } }
  }
}