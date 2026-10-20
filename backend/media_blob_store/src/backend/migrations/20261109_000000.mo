import Map "mo:core/Map";
import Region "mo:core/Region";
module {
  // Additive only. Preserve the existing bank-zero store and every old Slice.
  // No Regions or ciphertext copies are created during install/upgrade.
  public func migration(_ : {}) : {
    var media_regions : Map.Map<Nat, {
      region : Region.Region; var end : Nat64;
      free : Map.Map<Nat, Map.Map<Nat64, ()>>
    }>;
  } { { var media_regions = Map.empty() } }
}