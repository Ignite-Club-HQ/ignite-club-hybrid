import Map "mo:core/Map";
import Plan "../../broadcastPlan";
module {
  public func migration(_ : {}) : { var emailJobs : Map.Map<Text, { id : Text; kind : Text; resource : Text; ciphertext : Text; state : Text; attempt : Nat; worker : ?Principal; provider_id : Text; created_at_ms : Nat64 }>; var emailWorkers : [Principal]; var fixtureReceipts : Map.Map<Text, { creator : Principal; input : { competition_id : Text; home_team : Text; away_team : Text; division_id : ?Text; scheduled_at_ms : ?Nat64; venue : ?Text; pitch_number : ?Text; round_number : ?Nat16; duration_minutes : ?Nat16; arrival_minutes_before : ?Nat16; notes : ?Text }; match_id : Text }>;var broadcastPlans:Map.Map<Text,[Plan.Target]> } {
    { var emailJobs = Map.empty(); var emailWorkers = []; var fixtureReceipts = Map.empty();var broadcastPlans=Map.empty() }
  }
}