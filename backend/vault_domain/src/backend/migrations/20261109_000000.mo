import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  type File = { id : Text; folder_id : Text; club : Text; team : ?Text; name : Text; file_url : Text; size : Nat64; mime : Text; uploaded_by : Principal; created_at_ms : Nat64; deleted_at_ms : ?Nat64; deleted_by : ?Principal; mini_league_id : ?Text; competition_id : ?Text; is_external_link : Bool; blob_ref : ?{ canister : Text; path : Text; content_hash : Text } };
  public func migration(_ : {}) : { var uploadIntents : Map.Map<Text, { file : File; ready : Bool }>; var lifecycleFileCursor : Nat; var lifecycleCleanupCursor : Text } {
    { var uploadIntents = Map.empty<Text, { file : File; ready : Bool }>(); var lifecycleFileCursor = 0; var lifecycleCleanupCursor = "" }
  };
}