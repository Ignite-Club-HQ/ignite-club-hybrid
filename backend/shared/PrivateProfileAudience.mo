import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Text "mo:core/Text";
module {
  // Collision-free encoding of a bounded snapshot, never authorization.
  public func snapshotRevision(value : Text) : Nat {
    var out : Nat = 1;
    for (byte in Text.encodeUtf8(value).values()) { out := out * 256 + byte.toNat() };
    out
  };
}