import Map "mo:core/Map";
module {
  type Cleanup = { club : Text; team : ?Text; competition : ?Text; blob_ref : { canister : Text; path : Text; content_hash : Text }; state : { #pending; #erased; #complete } };
  public func migration(_ : {}) : { var cleanupRecords : Map.Map<Text, Cleanup> } {
    { var cleanupRecords = Map.empty<Text, Cleanup>() }
  }
}