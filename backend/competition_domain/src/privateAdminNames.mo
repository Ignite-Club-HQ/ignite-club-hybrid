import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  public func permitted(requester : Principal, member : Principal, subjects : [Principal], admins : [Principal]) : Bool {
    if (requester.isAnonymous() or member.isAnonymous() or requester.toText() == "aaaaa-aa" or member.toText() == "aaaaa-aa"
      or subjects.size() == 0 or subjects.size() > 25) return false;
    if (requester != member and not admins.any(func p = p == requester)) return false;
    subjects.all(func p = not p.isAnonymous() and p.toText() != "aaaaa-aa" and (p == member or admins.any(func a = a == p))
      and subjects.filter(func s = s == p).size() == 1)
  };
};