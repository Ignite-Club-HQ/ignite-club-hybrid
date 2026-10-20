import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : {
    var retained_mode : { #local; #frozen; #active }; var retained_snapshot_revision : Nat;
    var retained_revisions : Map.Map<Text, Nat>;
    var retained_deletions : Map.Map<Text, { token : Text; path : Text; club : Text; bytes : Nat; revision : Nat; owner : Principal; removed : Bool }>;
  } { { var retained_mode = #local; var retained_snapshot_revision = 0; var retained_revisions = Map.empty(); var retained_deletions = Map.empty() } }
}
