import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var emailJobs : Map.Map<Text, { id : Text; kind : Text; resource : Text; ciphertext : Text; state : Text; attempt : Nat; worker : ?Principal; provider_id : Text; created_at_ms : Nat64 }>; var emailWorkers : [Principal] } {
    { var emailJobs = Map.empty(); var emailWorkers = [] }
  }
}