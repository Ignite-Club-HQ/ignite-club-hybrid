import Nat "mo:core/Nat";
import Text "mo:core/Text";
module {
  // New tokens carry an immutable expiry epoch. Legacy tokens never retire.
  public func epoch(token : Text) : ?Nat {
    let parts = token.split(#char ':');
    if (parts.next() != ?"r1") return null;
    let ?value = parts.next() else return null;
    let ?sequence = parts.next() else return null;
    let ?kind = parts.next() else return null;
    if (parts.next() != null or sequence.toNat() == null or (kind != "upload" and kind != "delete")) return null;
    value.toNat()
  };
  public func expired(token : Text, current : Nat) : Bool {
    switch (epoch(token)) { case (?old) old + 1 < current; case null false }
  };
}