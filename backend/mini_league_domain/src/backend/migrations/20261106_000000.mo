import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : {
    var removal_intents : Map.Map<Text, { account_id : Text; generation : Nat64; inventory_digest : Blob; subjects : [Principal] }>;
    var removal_subjects : Map.Map<Principal, Text>;
    var removal_active : Map.Map<Principal, Nat>;
  } {
    { var removal_intents = Map.empty(); var removal_subjects = Map.empty(); var removal_active = Map.empty() }
  }
}
