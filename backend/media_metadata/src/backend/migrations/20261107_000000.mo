import Map "mo:core/Map";
module {
  public func migration(_ : {}) : {
    var assetPageIndex : Map.Map<Text, Map.Map<Text, Nat>>;
    var assetPageBuildPosition : Nat;
  } {
    { var assetPageIndex = Map.empty<Text, Map.Map<Text, Nat>>(); var assetPageBuildPosition = 0 }
  }
}