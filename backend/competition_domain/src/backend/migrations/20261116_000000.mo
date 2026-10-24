import Map "mo:core/Map";
module { public func migration(_ : {}) : { var broadcastErasureSubjects : Map.Map<Principal, [Principal]> } {
  { var broadcastErasureSubjects = Map.empty() }
} }