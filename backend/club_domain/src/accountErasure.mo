import Array "mo:core/Array";
import Principal "mo:core/Principal";
import Types "types";

module {
  public func keepRole(grant : Types.RoleGrant, principals : [Principal]) : Bool {
    not principals.any(func(p) = grant.user.equal(p))
  };
}