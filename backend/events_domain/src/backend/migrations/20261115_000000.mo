import Map "mo:core/Map";
module {
  public func migration(_ : {}) : {
    var fixtureMaterializations : Map.Map<Text, { revision : Nat64; input : { match_id : Text; competition_id : Text; creator : Principal; teams : [{ team_id : Text; club_id : Text }]; starts_at_ms : Nat64; ends_at_ms : Nat64; title : Text; venue : ?Text }; event_ids : [Text] }>;
    var gamePlayerDetails : Map.Map<Text, [{ user_id : ?Text; child_id : ?Text; position_seconds : ?[(Text, Nat32)] }]>;
  } { { var fixtureMaterializations = Map.empty(); var gamePlayerDetails = Map.empty() } }
}