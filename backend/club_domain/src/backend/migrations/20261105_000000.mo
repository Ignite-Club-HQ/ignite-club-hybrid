import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  type Object = { store : Principal; path : Text; club : Text; bytes : Nat; revision : Nat };
  type Operation = {
    store : Principal; token : Text; path : Text; club : Text; bytes : Nat;
    previous : ?Object; state : { #reserved; #committed; #released };
  };
  type Ledger = {
    objects : Map.Map<Text, Object>; operations : Map.Map<Text, Operation>;
    locks : Map.Map<Text, Text>; totals : Map.Map<Text, Nat>; pending : Map.Map<Text, Nat>;
    stores : Map.Map<Text, Bool>; revisions : Map.Map<Text, Nat>;
  };
  type Cursor = { phase : { #legacy; #indexed; #done }; offset : Nat; after : Text };
  type Row = { path : Text; club : ?Text; bytes : Nat; content_hash : Text; revision : Nat };
  type Page = { frozen : Bool; pending : Nat; authority : ?Principal; revision : Nat; total : Nat; total_bytes : Nat; cursor : Cursor; next : Cursor; rows : [Row] };
  type Progress = { cursor : Cursor; revision : ?Nat; total : ?Nat; total_bytes : ?Nat; count : Nat; bytes : Nat; done : Bool };
  type State = { var started : Bool; var active : Bool; var stores : [Principal]; imports : Map.Map<Text, Progress>; seen : Map.Map<Text, ()>; ledger : Ledger };
  public func migration(_ : {}) : { var mediaRetainedState : State } {
    { var mediaRetainedState = { var started = false; var active = false; var stores = []; imports = Map.empty(); seen = Map.empty(); ledger = { objects = Map.empty(); operations = Map.empty(); locks = Map.empty(); totals = Map.empty(); pending = Map.empty(); stores = Map.empty(); revisions = Map.empty() } } }
  }
}
