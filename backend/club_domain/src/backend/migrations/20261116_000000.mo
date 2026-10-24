import Map "mo:core/Map";
module { public func migration(_ : {}) : { var broadcastErasureSubjects : Map.Map<Principal, [Principal]>; var erasedBroadcastRelays : Map.Map<Text, Bool> } {
  { var broadcastErasureSubjects = Map.empty(); var erasedBroadcastRelays = Map.empty() }
} }