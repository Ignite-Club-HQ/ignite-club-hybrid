import Map "mo:core/Map";
module {
  // Infrastructure identities, not user principals. Tombstones retain CAS
  // revisions after an abort so old acknowledgements cannot be reused.
  public func migration(_ : {}) : {
    var clubMediaAuthorities : Map.Map<Text, { authority : ?Principal; revision : Nat; move_id : Text }>;
    var mediaAuthEpoch : Nat;
    var establishedVetkdKeyName : ?Text;
  } {
    { var clubMediaAuthorities = Map.empty<Text, { authority : ?Principal; revision : Nat; move_id : Text }>(); var mediaAuthEpoch = 0; var establishedVetkdKeyName = null }
  };
}