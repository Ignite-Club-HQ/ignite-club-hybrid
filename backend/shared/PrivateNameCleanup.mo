import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
module {
  public type Authority = { #NoName; #Unresolved; #Existing : { sink : Principal; subject : Principal } };
  public type Account = { account_id : Text; principals : [Principal]; account_version : Nat64; revision : Nat64; original_authority : Authority };
  public type Intent = { id : Text; club : Text; user : Principal; account : ?Account; submitted : Bool };
  public type Receipt = { id : Text; club : Text; subject : Principal; original_retained : Bool; replica_absent : Bool };
  public type Proof = { intent : Intent; members : [Bool] };
  public class Queue(rows : Map.Map<Text, Intent>) {
    public func locked() : Bool { rows.size() > 0 };
    public func enqueue(club : Text, user : Principal, generation : Nat) : Intent {
      let id = generation.toText() # ":" # club # ":" # user.toText();
      switch (rows.get(id)) { case (?saved) return saved; case null {} };
      let row = { id; club; user; account = null; submitted = false };
      rows.add(id, row); row
    };
    public func get(id : Text) : ?Intent { rows.get(id) };
    public func save(row : Intent) { rows.add(row.id, row) };
    public func finish(id : Text) { rows.remove(id) };
    public func first() : ?Intent { rows.values().next() };
  }
}