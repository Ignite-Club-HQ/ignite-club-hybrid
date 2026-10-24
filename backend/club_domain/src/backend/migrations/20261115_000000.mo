import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var seasonCloneReceipts : Map.Map<Text, { source : Text; name : Text; copy_staff : Bool; season_id : Text }>; var seasonTeamCopies : [(Text, Text, Text)]; var emailJobs : Map.Map<Text, { id : Text; kind : Text; resource : Text; ciphertext : Text; state : Text; attempt : Nat; worker : ?Principal; provider_id : Text; created_at_ms : Nat64 }>; var emailWorkers : [Principal]; var broadcastRelayReceipts : Map.Map<Text, { authority : Principal; queue : Principal; user : Principal; club : Text; competition : Text; teams : [Text]; officials : [Principal]; body : Text; key : Text; audience : [Text]; count : ?Nat16 }> } {
    { var seasonCloneReceipts = Map.empty(); var seasonTeamCopies = []; var emailJobs = Map.empty(); var emailWorkers = []; var broadcastRelayReceipts = Map.empty() }
  }
}