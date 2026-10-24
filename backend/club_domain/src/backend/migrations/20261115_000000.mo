import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var seasonCloneReceipts : Map.Map<Text, { source : Text; name : Text; copy_staff : Bool; season_id : Text }>; var seasonTeamCopies : [(Text, Text, Text)] } {
    { var seasonCloneReceipts = Map.empty(); var seasonTeamCopies = [] }
  }
}