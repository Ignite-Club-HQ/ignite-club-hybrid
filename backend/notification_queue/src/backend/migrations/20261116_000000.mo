import Map "mo:core/Map";
module { public func migration(_ : {}) : { var broadcastErasureSubjects : Map.Map<Principal, [Principal]>; var erasedCompetitionBroadcasts : Map.Map<Text, Bool> } {
  { var broadcastErasureSubjects = Map.empty(); var erasedCompetitionBroadcasts = Map.empty() }
} }