import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  type Usage = { count : Nat; bytes : Nat; pending_count : Nat; pending_bytes : Nat };
  type Reservation = { store : Principal; token : Text; club_id : Text; category : Text; cycle : Nat; bytes : Nat; status : { #reserved; #committed; #released } };
  type State = {
    var active : Bool; var started : Bool;
    imports : Map.Map<Text, { offset : Nat; total : ?Nat; done : Bool }>;
    imported_rows : Map.Map<Text, ()>;
    ledger : { usage : Map.Map<Text, Usage>; reservations : Map.Map<Text, Reservation> };
  };
  public func migration(_ : {}) : { var mediaQuotaCutover : State } {
    { var mediaQuotaCutover = { var active = false; var started = false; imports = Map.empty(); imported_rows = Map.empty(); ledger = { usage = Map.empty(); reservations = Map.empty() } } }
  }
}