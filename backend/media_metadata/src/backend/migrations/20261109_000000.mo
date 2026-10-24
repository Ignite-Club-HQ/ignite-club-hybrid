import Map "mo:core/Map";
module { public func migration(_ : {}) : { var galleryViewCounts : Map.Map<Text, Nat> } {
  { var galleryViewCounts = Map.empty<Text, Nat>() }
} }
