import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  public type Batch = { revision : Nat; requester : Principal; club : Text; subjects : [Principal]; members : [Bool] };
  public type Cursor = { revision : Nat; phase : Nat; offset : Nat };
  public type Page = { revision : Nat; subjects : [Principal]; next : ?Cursor; scanned : Nat };
  public func validate(requester : Principal, club : Text, subjects : [Principal]) : ?Text {
    if (requester.isAnonymous() or club == "" or club.size() > 128) return ?"Specific requester and club required";
    if (subjects.size() > 25) return ?"At most 25 profile candidates per batch";
    if (subjects.any(func p = p.isAnonymous())) return ?"Active candidate principals required";
    null
  };
  public func unchanged(start : Nat, current : Nat, authorityUnchanged : Bool, fenced : Bool) : Bool {
    start == current and authorityUnchanged and not fenced
  };
}