import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  type Operation = {
    owner : Principal; path : Text; club_id : Text; category : Text;
    bytes : Nat; cycle : Nat; created_at : Int;
    status : { #reserving; #uploading; #committing; #committed; #aborting; #aborted };
    result : ?{ path : Text; content_hash : Text; content_length : Nat64 };
  };
  public func migration(_ : {}) : {
    var quota_mode : { #local; #frozen; #sharedQuota };
    var quota_snapshot : [{ club_id : Text; cycle : Nat; category : Text; count : Nat; bytes : Nat64 }];
    var quota_operations : Map.Map<Text, Operation>;
  } {
    { var quota_mode = #local; var quota_snapshot = []; var quota_operations = Map.empty() }
  }
}