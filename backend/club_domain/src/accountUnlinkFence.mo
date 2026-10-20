import Array "mo:core/Array";
import Principal "mo:core/Principal";

/// Durable receipts invalidate obsolete account snapshots, not newer relinks.
module {
  public type Receipt = (Text, Principal, Nat64);
  public func rejects(account : Text, version : Nat64, principals : [Principal], receipts : [Receipt]) : Bool {
    receipts.any(func(r) = r.0 == account and r.2 >= version and principals.any(func(p) = p == r.1))
  };
}