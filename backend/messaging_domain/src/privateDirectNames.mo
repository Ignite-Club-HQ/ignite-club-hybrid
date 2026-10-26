import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  public type Batch = { revision : Nat; requester : Principal; club : Text; subjects : [Principal]; members : [Bool] };
  public func permitted(requester : Principal, subjects : [Principal], club : Text, participants : [Principal], blocked : Bool) : Bool {
    if (requester.isAnonymous() or requester.toText() == "aaaaa-aa" or club != "dm" or blocked or participants.size() != 2) return false;
    if (participants[0] == participants[1] or not participants.any(func p = p == requester)) return false;
    if (subjects.size() > 2 or subjects.any(func p = p.isAnonymous() or p.toText() == "aaaaa-aa" or not participants.any(func member = member == p))) return false;
    if (subjects.size() == 2 and subjects[0] == subjects[1]) return false;
    true
  };
}