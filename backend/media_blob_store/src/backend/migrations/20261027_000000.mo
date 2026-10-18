import Region "mo:core/Region";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  // Frozen inline types: never import evolving application record definitions.
  type Slice = { offset : Nat64; length : Nat; slot : Nat };
  type Record = { path : Text; mime : Text; owner : Principal; content_hash : Text; slice : Slice; uploaded_at : Int };
  public func migration(_ : {}) : {
    var stable_bytes : { region : Region.Region; var end : Nat64; free : Map.Map<Nat, Map.Map<Nat64, ()>> };
    var stable_blobs : Map.Map<Text, Record>;
    var stable_writes : Bool;
    var retention_cursor : Text;
    var legacy_retention_cursor : Nat;
  } {
    {
      var stable_bytes = { region = Region.new(); var end : Nat64 = 0; free = Map.empty<Nat, Map.Map<Nat64, ()>>() };
      var stable_blobs = Map.empty<Text, Record>();
      var stable_writes = false;
      var retention_cursor = "";
      var legacy_retention_cursor = 0;
    }
  }
}