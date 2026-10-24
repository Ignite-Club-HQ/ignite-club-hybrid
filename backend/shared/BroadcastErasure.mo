import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Text "mo:core/Text";
module {
  public func matches(subjects : [Principal], user : Text) : Bool {
    subjects.any(func p = user == p.toText() or user == "principal:" # p.toText())
  };
  public func completed(clubs : [Text], done : [(Text, Nat16)], unknown : ?Text) : Bool {
    unknown == null and clubs.size() == done.size() and
      clubs.all(func club = done.filter(func row = row.0 == club).size() == 1)
  };
}